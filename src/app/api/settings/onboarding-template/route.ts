import { NextResponse, type NextRequest } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { z } from "zod";
import {
  QUICK_SETUP_LIMITS,
  customizeTemplate,
  getOrgTemplate,
  isKnownZone,
  plannedDisabledJournals,
} from "@/lib/onboarding-templates";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { positionMatchKey } from "@/lib/sphere-positions";
import { pickMirrorArea } from "@/lib/area-building";
import { checkJournalLimit, limitResponse } from "@/lib/billing.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/onboarding-template
 * Body: { kind: "stand" | "cafe-small" | "restaurant" | "school" | "production" | "medical" | "hotel",
 *         answers?: { fridges, freezers, uvLamps, fryer, zones } }
 *
 * `answers` — «Настройка за 3 минуты» (21.11.2026): шаблон подгоняется под
 * заведение (`customizeTemplate`): столько холодильников, сколько есть,
 * только отмеченные помещения, оборудование — по помещениям, журналы — по
 * ответам. Без `answers` — шаблон как есть.
 *
 * Применяет шаблон к текущей организации:
 *   1. Создаёт JobPositions (idempotent — пропускает существующие).
 *   2. Создаёт первое здание + areas + equipment (idempotent).
 *   3. Устанавливает Organization.disabledJournalCodes — отключает
 *      журналы которых нет в template.enabledJournals.
 *   4. Для positions с seesAllTasks=true — выставляет флаг.
 *
 * Сотрудников и их телефоны admin создаёт вручную потом — этот
 * endpoint только базовая инфраструктура.
 *
 * Идемпотентно: повторное применение того же шаблона не дублирует.
 * Применение другого шаблона — добавит новые элементы, не удалит старые.
 */
const answersSchema = z.object({
  fridges: z.number().int().min(0).max(QUICK_SETUP_LIMITS.fridges),
  freezers: z.number().int().min(0).max(QUICK_SETUP_LIMITS.freezers),
  uvLamps: z.number().int().min(0).max(QUICK_SETUP_LIMITS.uvLamps),
  fryer: z.boolean(),
  zones: z.array(z.string().min(1).max(80)).min(1).max(QUICK_SETUP_LIMITS.zones),
});

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const organizationId = getActiveOrgId(session);
  const body = await request.json().catch(() => null);
  const kind = (body as { kind?: unknown } | null)?.kind;
  if (typeof kind !== "string") {
    return NextResponse.json(
      { error: "Body должен содержать kind: string" },
      { status: 400 },
    );
  }
  const base = getOrgTemplate(kind);
  if (!base) {
    return NextResponse.json(
      { error: `Неизвестный тип шаблона: ${kind}` },
      { status: 400 },
    );
  }
  const rawAnswers = (body as { answers?: unknown } | null)?.answers;
  let answers: z.infer<typeof answersSchema> | null = null;
  if (rawAnswers !== undefined && rawAnswers !== null) {
    const parsed = answersSchema.safeParse(rawAnswers);
    if (!parsed.success) {
      return NextResponse.json({ error: "Ответы мастера не похожи на правду — обновите страницу" }, { status: 400 });
    }
    const unknownZone = parsed.data.zones.find((name) => !isKnownZone(base, name));
    if (unknownZone) {
      return NextResponse.json({ error: `Неизвестное помещение: ${unknownZone}` }, { status: 400 });
    }
    answers = parsed.data;
  }
  const plan = customizeTemplate(base, answers);
  const template = plan.template;

  // Набор журналов — проверяем ДО любых записей: на бесплатном тарифе после
  // пробного включённым может быть один журнал, и шаблон не должен
  // примениться наполовину. Шаблон «все журналы» с ответами — текущий
  // выбор организации с поправками ответов.
  const currentDisabled = template.enabledJournals === null && (plan.enable.length || plan.disable.length)
    ? ((await db.organization.findUnique({ where: { id: organizationId }, select: { disabledJournalCodes: true } }))?.disabledJournalCodes as string[] | null) ?? []
    : [];
  const templateDisabled = plannedDisabledJournals(plan, ACTIVE_JOURNAL_CATALOG.map((j) => j.code), currentDisabled);
  if (templateDisabled) {
    const journals = await checkJournalLimit(organizationId, templateDisabled, { source: `onboarding-template:${template.kind}` });
    if (!journals.ok) return limitResponse(journals);
  }

  let positionsCreated = 0;
  let positionsUpdated = 0;
  let buildingId: string | null = null;
  let areasCreated = 0;
  let equipmentCreated = 0;

  // 1. Должности
  // Сравниваем по ключу, нечувствительному к регистру и роду: если в
  // организации уже есть «Заведующая производством», шаблонная
  // «Заведующий производством» — та же должность, не дубль.
  const orgPositions = await db.jobPosition.findMany({
    where: { organizationId },
    select: { id: true, name: true, categoryKey: true, seesAllTasks: true },
  });
  for (const [i, p] of template.positions.entries()) {
    const key = positionMatchKey(p.name);
    const existing = orgPositions.find(
      (pos) =>
        pos.categoryKey === p.categoryKey &&
        (pos.name === p.name || positionMatchKey(pos.name) === key),
    );
    if (existing) {
      // Обновляем seesAllTasks если шаблон требует.
      if (p.seesAllTasks && !existing.seesAllTasks) {
        await db.jobPosition.update({
          where: { id: existing.id },
          data: { seesAllTasks: true },
        });
        positionsUpdated += 1;
      }
      continue;
    }
    const created = await db.jobPosition.create({
      data: {
        organizationId,
        name: p.name,
        categoryKey: p.categoryKey,
        sortOrder: i,
        seesAllTasks: p.seesAllTasks === true,
      },
      select: { id: true, name: true, categoryKey: true, seesAllTasks: true },
    });
    orgPositions.push(created);
    positionsCreated += 1;
  }

  // 2. Building + Rooms (для журнала уборки) + Areas (производственные зоны)
  let building = await db.building.findFirst({
    where: { organizationId },
    select: { id: true },
  });
  if (!building) {
    building = await db.building.create({
      data: {
        organizationId,
        name: "Основная точка",
        sortOrder: 0,
      },
      select: { id: true },
    });
  }
  buildingId = building.id;

  // Rooms (для уборки) и Areas (для журнальных записей) создаём
  // ОДНОВРЕМЕННО — каждая area имеет «зеркало» room, чтобы матрица
  // уборки и production-зоны имели одинаковую базу.
  for (const a of template.areas) {
    // Room
    const existingRoom = await db.room.findFirst({
      where: { buildingId, name: a.name },
    });
    if (!existingRoom) {
      await db.room.create({
        data: {
          buildingId,
          name: a.name,
          kind: a.kind,
        },
      });
    }
    // Area — цех-зеркало помещения этой точки (2026-10-17), то же правило,
    // что у POST /api/settings/rooms: цех этой точки, иначе цех без точки
    // (он получает точку); одноимённый цех другой точки — не наш.
    const existingArea = pickMirrorArea(
      await db.area.findMany({
        where: { organizationId },
        select: { id: true, name: true, buildingId: true },
      }),
      a.name,
      buildingId,
    );
    if (!existingArea) {
      await db.area.create({
        data: {
          organizationId,
          name: a.name,
          buildingId,
        },
      });
      areasCreated += 1;
    } else if (!existingArea.buildingId) {
      await db.area.update({ where: { id: existingArea.id }, data: { buildingId } });
    }
  }

  // Equipment — в помещение, которое выбрал `customizeTemplate` (холод —
  // склад/камера, УФ — цеха по кругу, фритюр — горячий цех); нет такого
  // помещения — в первое.
  const allAreas = await db.area.findMany({
    where: { organizationId },
    select: { id: true, name: true, buildingId: true },
  });
  if (allAreas.length > 0) {
    const defaultAreaId = allAreas[0].id;
    const areaIdFor = (name: string | undefined) =>
      (name && (allAreas.find((area) => area.name === name && area.buildingId === buildingId) ?? allAreas.find((area) => area.name === name))?.id) || defaultAreaId;
    for (const e of template.equipment) {
      const existing = await db.equipment.findFirst({
        where: { area: { organizationId }, name: e.name },
      });
      if (existing) continue;
      await db.equipment.create({
        data: {
          areaId: areaIdFor(e.areaName),
          name: e.name,
          type: e.type,
          tempMin: e.tempMin ?? null,
          tempMax: e.tempMax ?? null,
        },
      });
      equipmentCreated += 1;
    }
  }

  // 3. Disabled journals — то, чего НЕТ в template.enabledJournals.
  //
  // `null` означает «шаблон про журналы ничего не говорит», и раньше мы
  // трактовали это как «включить все журналы», затирая набор по сфере и
  // ручные тумблеры. Карточка обещает добавление, а не замену — поэтому
  // при `null` набор не трогаем вовсе.
  if (templateDisabled) {
    await db.organization.update({
      where: { id: organizationId },
      data: { disabledJournalCodes: templateDisabled as never },
    });
  }

  return NextResponse.json({
    ok: true,
    template: template.kind,
    positionsCreated,
    positionsUpdated,
    areasCreated,
    equipmentCreated,
    journalsEnabled: templateDisabled ? ACTIVE_JOURNAL_CATALOG.length - templateDisabled.length : null,
  });
}

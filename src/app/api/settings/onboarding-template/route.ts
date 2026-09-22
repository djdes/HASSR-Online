import { NextResponse, type NextRequest } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { getOrgTemplate } from "@/lib/onboarding-templates";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { positionMatchKey } from "@/lib/sphere-positions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/onboarding-template
 * Body: { kind: "stand" | "cafe-small" | "restaurant" | "school" | "production" }
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
  const template = getOrgTemplate(kind);
  if (!template) {
    return NextResponse.json(
      { error: `Неизвестный тип шаблона: ${kind}` },
      { status: 400 },
    );
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
    // Area
    const existingArea = await db.area.findFirst({
      where: { organizationId, name: a.name },
    });
    if (!existingArea) {
      await db.area.create({
        data: {
          organizationId,
          name: a.name,
        },
      });
      areasCreated += 1;
    }
  }

  // Equipment — привязываем к первой подходящей area (kitchen/storage/wash)
  const allAreas = await db.area.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  });
  if (allAreas.length > 0) {
    const defaultAreaId = allAreas[0].id;
    for (const e of template.equipment) {
      const existing = await db.equipment.findFirst({
        where: { area: { organizationId }, name: e.name },
      });
      if (existing) continue;
      await db.equipment.create({
        data: {
          areaId: defaultAreaId,
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
  // трактовали это как «включить все 35», затирая набор по сфере и
  // ручные тумблеры. Карточка обещает добавление, а не замену — поэтому
  // при `null` набор не трогаем вовсе.
  if (template.enabledJournals !== null) {
    const enabled = new Set(template.enabledJournals);
    const allCodes = ACTIVE_JOURNAL_CATALOG.map((j) => j.code);
    const disabled = allCodes.filter((c) => !enabled.has(c));
    await db.organization.update({
      where: { id: organizationId },
      data: { disabledJournalCodes: disabled as never },
    });
  }

  return NextResponse.json({
    ok: true,
    template: template.kind,
    positionsCreated,
    positionsUpdated,
    areasCreated,
    equipmentCreated,
  });
}

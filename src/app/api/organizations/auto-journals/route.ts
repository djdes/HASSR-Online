import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  parseJournalAutomationJson,
  type JournalAutomation,
  type JournalAutomationMap,
  type JournalAutomationResponsibles,
  type JournalAutomationStaff,
} from "@/lib/journal-automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/organizations/auto-journals
 * Body: { codes: string[] }
 *
 * Сохраняет список templateCode'ов, для которых cron каждый день
 * проверяет наличие активного документа и создаёт новый на текущий
 * месяц если нет. Managed через /settings/auto-journals.
 */
/**
 * Политика ответственных для новых документов. «Не передана» и «передана»
 * — разные вещи: первое сохраняет то, что было (таблица
 * /settings/auto-journals политик не знает), второе перезаписывает.
 */
const responsiblesSchema = z.union([
  z.object({ mode: z.literal("inherit") }),
  z.object({
    mode: z.literal("custom"),
    responsibleUserId: z.string().min(1, "Выберите ответственного"),
    verifierUserId: z.string().min(1).nullable().optional(),
  }),
]);

/** Политика списка сотрудников-строк (только гигиена и здоровье). */
const staffSchema = z.union([
  z.object({ mode: z.literal("inherit") }),
  z.object({
    mode: z.literal("custom"),
    userIds: z.array(z.string().min(1)).max(200),
  }),
]);

const bodySchema = z.object({
  /** Легаси-формат: только автосоздание. */
  codes: z.array(z.string().min(1)).optional(),
  /**
   * Новый формат: обе половинки автоматики на каждый журнал. Одна
   * таблица в /settings/auto-journals — колонки «автосоздание» и
   * «автозаполнение».
   */
  items: z
    .array(
      z.object({
        code: z.string().min(1),
        autoCreate: z.boolean(),
        /**
         * Необязателен НАМЕРЕННО. Тумблер «создавать журнал на новый
         * период» на странице журнала шлёт только `autoCreate`; передавай
         * он `autoFill: false` — любое его переключение молча выключало бы
         * ежедневное автозаполнение, у которого свой тумблер в документе.
         * Не передан — сохраняем то, что было.
         */
        autoFill: z.boolean().optional(),
        /** См. `responsiblesSchema`: не передано — сохраняем прошлое. */
        responsibles: responsiblesSchema.optional(),
        /** См. `staffSchema`: не передано — сохраняем прошлое. */
        staff: staffSchema.optional(),
      })
    )
    .optional(),
});

function normalizeResponsibles(
  value: z.infer<typeof responsiblesSchema>
): JournalAutomationResponsibles {
  if (value.mode === "inherit") return { mode: "inherit" };
  return {
    mode: "custom",
    responsibleUserId: value.responsibleUserId,
    verifierUserId: value.verifierUserId ?? null,
  };
}

function normalizeStaff(
  value: z.infer<typeof staffSchema>
): JournalAutomationStaff {
  if (value.mode === "inherit") return { mode: "inherit" };
  return { mode: "custom", userIds: [...new Set(value.userIds)] };
}

/** Все явно выбранные id из политик — их надо проверить одним запросом. */
function collectCustomUserIds(
  items: NonNullable<z.infer<typeof bodySchema>["items"]>
): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.responsibles?.mode === "custom") {
      ids.add(item.responsibles.responsibleUserId);
      if (item.responsibles.verifierUserId) {
        ids.add(item.responsibles.verifierUserId);
      }
    }
    if (item.staff?.mode === "custom") {
      for (const id of item.staff.userIds) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * GET — текущее состояние автоматики по журналам.
 *
 * Нужен переключателю, который стоит в самом документе: он показывается
 * там, где человек работает с журналом, и своего состояния не знает —
 * страница документа про настройки организации ничего не грузит.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const org = await db.organization.findUnique({
    where: { id: getActiveOrgId(session) },
    select: { journalAutomationJson: true },
  });

  return NextResponse.json({
    automation: parseJournalAutomationJson(org?.journalAutomationJson),
  });
}

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Некорректный список" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Некорректный список" }, { status: 400 });
  }
  const organizationId = getActiveOrgId(session);

  // Новый формат побеждает: он несёт обе половинки. Легаси `codes`
  // трактуем как «только автосоздание», не трогая автозаполнение —
  // старый клиент про него ничего не знает.
  if (parsed.items) {
    // Выбранные люди должны быть живыми сотрудниками ЭТОЙ организации:
    // иначе политика молча указывала бы на чужой или уволенный аккаунт.
    const customIds = collectCustomUserIds(parsed.items);
    if (customIds.length > 0) {
      const alive = await db.user.findMany({
        where: {
          id: { in: customIds },
          organizationId,
          isActive: true,
          archivedAt: null,
        },
        select: { id: true },
      });
      if (alive.length !== customIds.length) {
        return NextResponse.json(
          { error: "Выбран сотрудник, которого нет в организации" },
          { status: 400 }
        );
      }
    }

    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { journalAutomationJson: true },
    });
    const map: JournalAutomationMap = parseJournalAutomationJson(
      org?.journalAutomationJson
    );
    const autoFillChanges: { code: string; next: boolean }[] = [];
    for (const item of parsed.items) {
      const previous = map[item.code];
      const entry: JournalAutomation = {
        autoCreate: item.autoCreate,
        autoFill: item.autoFill ?? previous?.autoFill ?? false,
      };
      const responsibles = item.responsibles
        ? normalizeResponsibles(item.responsibles)
        : previous?.responsibles;
      if (responsibles) entry.responsibles = responsibles;
      const staff = item.staff ? normalizeStaff(item.staff) : previous?.staff;
      if (staff) entry.staff = staff;
      map[item.code] = entry;
      if (entry.autoFill !== (previous?.autoFill ?? false)) {
        autoFillChanges.push({ code: item.code, next: entry.autoFill });
      }
    }
    const codes = Object.entries(map)
      .filter(([, value]) => value.autoCreate)
      .map(([code]) => code)
      .sort();
    await db.organization.update({
      where: { id: organizationId },
      data: {
        journalAutomationJson: map as never,
        autoJournalCodes: codes as never,
      },
    });

    // Тумблер автозаполнения живёт и в организации, и в каждом документе.
    // Без каскада включение в журнале не действовало на уже открытый
    // период: крон смотрит на флаг ДОКУМЕНТА и молча пропускал его.
    const now = new Date();
    const todayUtcStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    let cascaded = 0;
    for (const change of autoFillChanges) {
      const updated = await db.journalDocument.updateMany({
        where: {
          organizationId,
          status: "active",
          template: { code: change.code },
          dateTo: { gte: todayUtcStart },
        },
        data: { autoFill: change.next },
      });
      cascaded += updated.count;
    }

    return NextResponse.json({ codes, automation: map, cascaded });
  }

  const unique = Array.from(new Set(parsed.codes ?? []));
  await db.organization.update({
    where: { id: organizationId },
    data: { autoJournalCodes: unique },
  });
  return NextResponse.json({ codes: unique });
}

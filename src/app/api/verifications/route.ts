import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { generatePoolForDay } from "@/lib/journal-task-pool";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { resolveDayStart } from "@/lib/today-compliance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POOL_CODES = [
  "hygiene",
  "health_check",
  "cold_equipment_control",
  "climate_control",
  "cleaning",
  "incoming_control",
  "finished_product",
  "disinfectant_usage",
  "fryer_oil",
  "accident_journal",
  "complaint_register",
  "breakdown_history",
  "ppe_issuance",
  "glass_items_list",
  "glass_control",
  "metal_impurity",
  "perishable_rejection",
  "product_writeoff",
  "traceability_test",
  "general_cleaning",
  "sanitation_day_control",
  "sanitary_day_control",
  "pest_control",
  "intensive_cooling",
  "uv_lamp_runtime",
  "equipment_maintenance",
  "equipment_calibration",
  "equipment_cleaning",
];

const JOURNAL_LABELS: Record<string, string> = {
  hygiene: "Гигиена",
  health_check: "Здоровье",
  cold_equipment_control: "Холодильники",
  climate_control: "Климат",
  cleaning: "Уборка",
  incoming_control: "Приёмка",
  finished_product: "Бракераж",
  disinfectant_usage: "Дезсредства",
  fryer_oil: "Фритюр",
  accident_journal: "Аварии",
  complaint_register: "Жалобы",
  breakdown_history: "Поломки",
  ppe_issuance: "СИЗ",
  glass_items_list: "Стекло",
  glass_control: "Контроль стекла",
  metal_impurity: "Металлопримеси",
  perishable_rejection: "Скоропорт",
  product_writeoff: "Списание",
  traceability_test: "Прослеживаемость",
  general_cleaning: "Генуборка",
  sanitation_day_control: "Сан. день",
  sanitary_day_control: "Сан. день",
  pest_control: "Дератизация",
  intensive_cooling: "Интенс. охл.",
  uv_lamp_runtime: "УФ-лампа",
  equipment_maintenance: "Тех. обслуж.",
  equipment_calibration: "Поверка",
  equipment_cleaning: "Чистка обор.",
};

/**
 * GET /api/verifications — комплексная сводка для заведующей.
 *
 * Возвращает три раздела:
 *   - pendingReview — completed задачи со status=pending verification (надо одобрить)
 *   - inProgress    — active claims (в работе у сотрудников)
 *   - notTaken      — pool scopes без claim (никто не взял)
 *   - approved/rejected — для filter'а if hist=true
 *
 * Сверху всё что требует действия, снизу — невзятые задачи (заведующая
 * видит что ещё надо делать).
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!hasCapability(session.user, "tasks.verify")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);
  const url = new URL(request.url);
  const histFilter = url.searchParams.get("hist"); // approved | rejected | null

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { disabledJournalCodes: true, timezone: true },
  });
  const disabled = parseDisabledCodes(org?.disabledJournalCodes);
  // «Сегодня» — в поясе организации: claim'ы сохраняются под днём
  // телефона сотрудника, и ночью по Москве UTC-день — это ещё вчера.
  const today = resolveDayStart(org?.timezone ?? null, new Date());
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  // 1) Pending review claims. Skipped (completionData.skipped=true)
  // выпадают из верификации — они auto-approved.
  const pendingClaims = await db.journalTaskClaim.findMany({
    where: {
      organizationId,
      status: "completed",
      OR: [{ verificationStatus: null }, { verificationStatus: "pending" }],
    },
    include: {
      user: { select: { id: true, name: true } },
      verifiedBy: { select: { name: true } },
    },
    orderBy: { completedAt: "desc" },
    take: 100,
  });

  // 2) In-progress claims — для info.
  const activeClaims = await db.journalTaskClaim.findMany({
    where: { organizationId, status: "active" },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { claimedAt: "asc" },
  });

  // 3) Hist (approved / rejected) — только если запрошено.
  const histClaims =
    histFilter === "approved" || histFilter === "rejected"
      ? await db.journalTaskClaim.findMany({
          where: {
            organizationId,
            status: histFilter === "approved" ? "completed" : { in: ["completed", "active"] },
            verificationStatus: histFilter,
          },
          include: {
            user: { select: { id: true, name: true } },
            verifiedBy: { select: { name: true } },
          },
          orderBy: { verifiedAt: "desc" },
          take: 50,
        })
      : [];

  // 4) Not taken — pool generator по всем кодам, минус scopes уже claimed (любой статус).
  type ScopeBase = {
    journalCode: string;
    journalLabel: string;
    scopeKey: string;
    scopeLabel: string;
    sublabel?: string;
    journalDocumentId?: string;
  };
  const notTaken: ScopeBase[] = [];

  for (const code of POOL_CODES) {
    if (disabled.has(code)) continue;
    const pool = await generatePoolForDay({
      organizationId,
      journalCode: code,
      date: today,
    });
    if (!pool.pool || pool.scopes.length === 0) continue;

    const claims = await db.journalTaskClaim.findMany({
      where: {
        organizationId,
        journalCode: code,
        dateKey: { gte: today, lt: tomorrow },
        status: { in: ["active", "completed"] },
      },
      select: { scopeKey: true },
    });
    const taken = new Set(claims.map((c) => c.scopeKey));

    for (const s of pool.scopes) {
      if (taken.has(s.scopeKey)) continue;
      notTaken.push({
        journalCode: code,
        journalLabel: JOURNAL_LABELS[code] ?? code,
        scopeKey: s.scopeKey,
        scopeLabel: s.scopeLabel,
        sublabel: s.sublabel,
        journalDocumentId: s.journalDocumentId,
      });
    }
  }

  // Норма температуры из карточки оборудования (scopeKey вида
  // `fridge:<equipmentId>:…`) — чтобы заведующая видела замер вне нормы.
  const fridgeIds = [
    ...new Set(
      [...pendingClaims, ...histClaims]
        .map((c) => /^fridge:([^:]+):/.exec(c.scopeKey)?.[1])
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const normByEquipment = new Map<string, { min: number | null; max: number | null }>();
  if (fridgeIds.length > 0) {
    const equipment = await db.equipment.findMany({
      where: { id: { in: fridgeIds }, area: { organizationId } },
      select: { id: true, tempMin: true, tempMax: true },
    });
    for (const item of equipment) {
      if (item.tempMin !== null || item.tempMax !== null) {
        normByEquipment.set(item.id, { min: item.tempMin, max: item.tempMax });
      }
    }
  }
  const withNorm = (c: Parameters<typeof toItem>[0] & { scopeKey: string }) => ({
    ...toItem(c),
    temperatureNorm:
      normByEquipment.get(/^fridge:([^:]+):/.exec(c.scopeKey)?.[1] ?? "") ?? null,
  });

  return NextResponse.json({
    today: today.toISOString().slice(0, 10),
    pendingReview: pendingClaims.map(withNorm),
    inProgress: activeClaims.map((c) => ({
      id: c.id,
      scopeLabel: c.scopeLabel,
      journalCode: c.journalCode,
      journalLabel: JOURNAL_LABELS[c.journalCode] ?? c.journalCode,
      executedBy: c.user.name,
      executedById: c.user.id,
      claimedAt: c.claimedAt.toISOString(),
      // День задачи. Зависшую со вчера видно по дате: раньше она
      // выглядела как взятая сегодня и «Зависло» ничего не объясняло.
      dateKey: c.dateKey.toISOString().slice(0, 10),
      fromPreviousDay: c.dateKey < today,
      // Зависает в работе > 2h?
      overdue: Date.now() - c.claimedAt.getTime() > 2 * 60 * 60 * 1000,
    })),
    notTaken,
    hist: histClaims.map(withNorm),
    summary: {
      pending: pendingClaims.length,
      inProgress: activeClaims.length,
      notTaken: notTaken.length,
    },
  });
}

function toItem(c: {
  id: string;
  scopeLabel: string;
  journalCode: string;
  user: { id: string; name: string };
  completedAt: Date | null;
  verificationStatus: string | null;
  verifiedBy: { name: string } | null;
  verifiedAt: Date | null;
  verifierComment: string | null;
  completionData: unknown;
  dateKey: Date;
}) {
  return {
    id: c.id,
    scopeLabel: c.scopeLabel,
    journalCode: c.journalCode,
    journalLabel: JOURNAL_LABELS[c.journalCode] ?? c.journalCode,
    executedBy: c.user.name,
    executedById: c.user.id,
    completedAt: c.completedAt?.toISOString() ?? null,
    verificationStatus: c.verificationStatus,
    verifiedBy: c.verifiedBy?.name ?? null,
    verifiedAt: c.verifiedAt?.toISOString() ?? null,
    verifierComment: c.verifierComment,
    completionData: (c.completionData as Record<string, unknown> | null) ?? null,
    dateKey: c.dateKey.toISOString(),
  };
}

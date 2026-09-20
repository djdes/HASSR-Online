import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability, effectivePreset } from "@/lib/permission-presets";
import { generatePoolForDay, type TaskScope } from "@/lib/journal-task-pool";
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
 * GET /api/control-board
 *
 * Все задачи дня из всех pool-журналов организации, объединённые в
 * один список со статусами и владельцами для контроля заведующей.
 *
 * Возвращает:
 *   - tasks: TaskRow[] — каждый scope = одна строка с status + assignee
 *   - subordinates: SubordinateRow[] — все её сотрудники + work stats
 *   - summary: counts + alerts
 *
 * Доступ: tasks.verify ИЛИ admin.full.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (
    !hasCapability(session.user, "tasks.verify") &&
    !hasCapability(session.user, "admin.full")
  ) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const organizationId = getActiveOrgId(session);
  const myUserId = session.user.id;
  const isAdmin = hasCapability(session.user, "admin.full");

  // «Сегодня» — в поясе организации: claim'ы сохраняются под днём
  // телефона сотрудника, и ночью по Москве UTC-день — это ещё вчера.
  const orgDay = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const today = resolveDayStart(orgDay?.timezone ?? null, new Date());
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  // 1) Resolve subordinates через ManagerScope (для admin'а — все).
  let allowedUserIds: string[] | null = null;
  if (!isAdmin) {
    const scope = await db.managerScope.findFirst({
      where: { organizationId, managerId: myUserId },
    });
    if (scope) {
      if (scope.viewMode === "none") allowedUserIds = [];
      else if (scope.viewMode === "specific_users")
        allowedUserIds = scope.viewUserIds;
      else if (scope.viewMode === "job_positions") {
        const usersByPos = await db.user.findMany({
          where: {
            organizationId,
            jobPositionId: { in: scope.viewJobPositionIds },
            isActive: true,
            archivedAt: null,
          },
          select: { id: true },
        });
        allowedUserIds = usersByPos.map((u) => u.id);
      }
    }
  }

  const subordinates = await db.user.findMany({
    where: {
      organizationId,
      isActive: true,
      archivedAt: null,
      ...(allowedUserIds ? { id: { in: allowedUserIds } } : {}),
      NOT: { id: myUserId },
    },
    select: {
      id: true,
      name: true,
      role: true,
      permissionPreset: true,
      jobPosition: { select: { name: true } },
      positionTitle: true,
      telegramChatId: true,
    },
  });
  const subUserIds = new Set(subordinates.map((u) => u.id));
  const userById = new Map(subordinates.map((u) => [u.id, u]));

  // 2) Все pools per journalCode + claims.
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { disabledJournalCodes: true },
  });
  const disabled = parseDisabledCodes(org?.disabledJournalCodes);

  type TaskRow = {
    journalCode: string;
    journalLabel: string;
    scopeKey: string;
    scopeLabel: string;
    sublabel?: string;
    journalDocumentId?: string;
    status: "not_taken" | "in_progress" | "pending_review" | "approved" | "rejected" | "completed";
    assigneeId: string | null;
    assigneeName: string | null;
    claimId: string | null;
    claimedAt: string | null;
    completedAt: string | null;
    /** Простаивает > 2 часов в работе. */
    overdueInProgress: boolean;
  };

  const tasks: TaskRow[] = [];

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
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { claimedAt: "desc" },
    });

    // Group by scopeKey: один active или completed per scope.
    const byScope = new Map<string, (typeof claims)[number]>();
    for (const c of claims) {
      const cur = byScope.get(c.scopeKey);
      // Приоритет: completed > active > released/expired.
      if (
        !cur ||
        priorityRank(c.status) > priorityRank(cur.status) ||
        (priorityRank(c.status) === priorityRank(cur.status) && c.claimedAt > cur.claimedAt)
      ) {
        byScope.set(c.scopeKey, c);
      }
    }

    for (const scope of pool.scopes) {
      const claim = byScope.get(scope.scopeKey);
      const row = buildTaskRow(code, JOURNAL_LABELS[code] ?? code, scope, claim);
      tasks.push(row);
    }
  }

  // 3) Per-subordinate summary.
  type SubRow = {
    id: string;
    name: string;
    preset: string;
    positionLabel: string;
    hasTelegram: boolean;
    inProgressCount: number;
    pendingReviewCount: number;
    approvedCount: number;
    rejectedCount: number;
    notStarted: boolean;
  };

  const perSub: Record<string, SubRow> = {};
  for (const u of subordinates) {
    perSub[u.id] = {
      id: u.id,
      name: u.name,
      preset: effectivePreset({
        permissionPreset: u.permissionPreset,
        role: u.role,
      }),
      positionLabel:
        u.jobPosition?.name?.trim() || u.positionTitle?.trim() || u.role,
      hasTelegram: Boolean(u.telegramChatId),
      inProgressCount: 0,
      pendingReviewCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      notStarted: true,
    };
  }
  for (const t of tasks) {
    if (!t.assigneeId || !subUserIds.has(t.assigneeId)) continue;
    const row = perSub[t.assigneeId];
    if (!row) continue;
    row.notStarted = false;
    if (t.status === "in_progress") row.inProgressCount += 1;
    if (t.status === "pending_review") row.pendingReviewCount += 1;
    if (t.status === "approved") row.approvedCount += 1;
    if (t.status === "rejected") row.rejectedCount += 1;
  }

  // 4) Summary.
  const summary = {
    total: tasks.length,
    notTaken: tasks.filter((t) => t.status === "not_taken").length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    pendingReview: tasks.filter((t) => t.status === "pending_review").length,
    approved: tasks.filter((t) => t.status === "approved").length,
    rejected: tasks.filter((t) => t.status === "rejected").length,
    overdue: tasks.filter((t) => t.overdueInProgress).length,
    notStartedCount: Object.values(perSub).filter((s) => s.notStarted && s.hasTelegram).length,
    noTelegramCount: subordinates.filter((u) => !u.telegramChatId).length,
  };

  return NextResponse.json({
    today: today.toISOString().slice(0, 10),
    tasks,
    subordinates: Object.values(perSub),
    summary,
  });
}

function priorityRank(status: string): number {
  switch (status) {
    case "completed":
      return 5;
    case "active":
      return 4;
    case "released":
      return 1;
    case "expired":
      return 1;
    default:
      return 0;
  }
}

function buildTaskRow(
  code: string,
  label: string,
  scope: TaskScope,
  claim:
    | {
        id: string;
        userId: string;
        user: { id: string; name: string };
        status: string;
        claimedAt: Date;
        completedAt: Date | null;
        verificationStatus: string | null;
      }
    | undefined
): {
  journalCode: string;
  journalLabel: string;
  scopeKey: string;
  scopeLabel: string;
  sublabel?: string;
  journalDocumentId?: string;
  status: "not_taken" | "in_progress" | "pending_review" | "approved" | "rejected" | "completed";
  assigneeId: string | null;
  assigneeName: string | null;
  claimId: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  overdueInProgress: boolean;
} {
  let status: "not_taken" | "in_progress" | "pending_review" | "approved" | "rejected" | "completed" = "not_taken";
  if (claim) {
    if (claim.status === "active") {
      status = "in_progress";
    } else if (claim.status === "completed") {
      const v = claim.verificationStatus;
      if (v === "approved") status = "approved";
      else if (v === "rejected") status = "rejected";
      else status = "pending_review";
    } else {
      status = "not_taken"; // released / expired — задача снова доступна
    }
  }

  const inProgressTooLong =
    claim?.status === "active" &&
    Date.now() - claim.claimedAt.getTime() > 2 * 60 * 60 * 1000;

  return {
    journalCode: code,
    journalLabel: label,
    scopeKey: scope.scopeKey,
    scopeLabel: scope.scopeLabel,
    sublabel: scope.sublabel,
    journalDocumentId: scope.journalDocumentId,
    status,
    assigneeId: claim?.userId ?? null,
    assigneeName: claim?.user.name ?? null,
    claimId: claim?.id ?? null,
    claimedAt: claim?.claimedAt ? claim.claimedAt.toISOString() : null,
    completedAt: claim?.completedAt ? claim.completedAt.toISOString() : null,
    overdueInProgress: inProgressTooLong,
  };
}

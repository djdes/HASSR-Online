import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getActiveBuildingId } from "@/lib/active-building";
import { buildingWhere } from "@/lib/building-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { CLOSE_DAY_JOURNAL_CODES } from "@/lib/daily-journal-codes";
import { recordAuditLog } from "@/lib/audit-log";
import { buildDateKeys, toDateKey } from "@/lib/hygiene-document";
import { resolveDayStart } from "@/lib/today-compliance";
import { applyJournalAutoFill } from "@/lib/journal-autofill";
import { getAutofillCapability } from "@/lib/journal-autofill-capability";
import { ensureActiveDocument } from "@/lib/journal-auto-create";
import { getJournalAutomation } from "@/lib/journal-automation";
import { resolveAutomationStaff } from "@/lib/journal-automation-staff";
import { prefillResponsiblesForNewDocument } from "@/lib/journal-responsibles-cascade";
import { getUserPositionLabel } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/dashboard/close-day
 *
 * «Закрыть день» на дашборде. Для каждого ежедневного журнала
 * организации:
 *
 *   1. Находит активный документ на дату (или создаёт его на текущий
 *      период — ответственные подбираются по правилам должностей
 *      журнала, см. prefillResponsiblesForNewDocument).
 *   2. Если у документа нет живого ответственного / проверяющего —
 *      подбирает их теми же правилами и записывает в документ.
 *   3. Заполняет ВСЕ пустые дни от начала периода до `upTo`
 *      (по умолчанию — сегодня в зоне организации):
 *        • кадровые журналы — состав из прошлого заполнения
 *          (политика автоматики «как в последнем журнале» / список
 *          должностей), выходные, отпуска и больничные из графика;
 *        • замеры (климат, холодильники) — с последнего заполненного
 *          дня с небольшим разбросом и зажимом в нормы; если заполнений
 *          не было — генерация по нормам из настроек журнала;
 *        • остальные — по настройкам журнала (движок journal-autofill);
 *        • уборка — план Т/Г по расписанию помещений.
 *      Уже заполненные ячейки не трогаются; действие идемпотентно.
 *
 * Body: `{ templateCodes?: string[]; upTo?: "YYYY-MM-DD" }`.
 * Доступно только management-ролям.
 */

type Body = { templateCodes?: string[]; upTo?: string };

const CLOSE_DAY_CODES = CLOSE_DAY_JOURNAL_CODES;

export type CloseDaySummary = {
  templateCode: string;
  templateName: string;
  documentId: string;
  documentTitle: string;
  /** Записей создано + дозаполнено. */
  filled: number;
  /** Дней в обработанном диапазоне. */
  days: number;
  documentCreated: boolean;
  responsiblesAssigned: boolean;
  skippedReason?:
    | "out_of_period"
    | "no_document"
    | "period_closed"
    | "no_employees"
    | "no_responsible"
    | "unsupported"
    | "error";
};

function utcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function parseDateKey(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : value;
}

function parseDisabledCodes(value: unknown): Set<string> {
  return new Set(
    Array.isArray(value)
      ? value.filter((x): x is string => typeof x === "string")
      : []
  );
}

export async function POST(request: Request) {
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

  const body = (await request.json().catch(() => ({}))) as Body;
  const filterCodes = Array.isArray(body?.templateCodes)
    ? new Set(body.templateCodes.filter((c) => typeof c === "string"))
    : null;

  const organizationId = getActiveOrgId(session);
  // Точки: закрываем день и создаём документ для активной точки.
  const activeBuildingId = await getActiveBuildingId(session);
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      timezone: true,
      disabledJournalCodes: true,
      journalAutomationJson: true,
      autoJournalCodes: true,
    },
  });
  const disabledCodes = parseDisabledCodes(org?.disabledJournalCodes);

  const now = new Date();
  const todayKey = toDateKey(resolveDayStart(org?.timezone ?? null, now));
  // «По какую дату»: по умолчанию сегодня; будущее зажимаем в сегодня.
  const requested = parseDateKey(body?.upTo);
  const upToKey = requested && requested < todayKey ? requested : todayKey;
  const upToDate = new Date(`${upToKey}T00:00:00.000Z`);

  const codes = [...CLOSE_DAY_CODES].filter(
    (c) => !disabledCodes.has(c) && (!filterCodes || filterCodes.has(c))
  );
  const templates = await db.journalTemplate.findMany({
    where: { code: { in: codes }, isActive: true },
    select: { id: true, code: true, name: true },
  });

  // Ростер: активные, не в архиве, не уволенные на дату.
  const employees = await db.user.findMany({
    where: {
      organizationId,
      isActive: true,
      archivedAt: null,
      OR: [{ dismissal: null }, { dismissal: { date: { gt: upToDate } } }],
    },
    select: { id: true, name: true, role: true },
    orderBy: { id: "asc" },
  });
  const employeeIds = employees.map((e) => e.id);
  const aliveIds = new Set(employeeIds);

  const summaries: CloseDaySummary[] = [];
  let totalFilled = 0;
  let documentsCreated = 0;

  for (const tpl of templates) {
    const summary: CloseDaySummary = {
      templateCode: tpl.code,
      templateName: tpl.name,
      documentId: "",
      documentTitle: "",
      filled: 0,
      days: 0,
      documentCreated: false,
      responsiblesAssigned: false,
    };
    summaries.push(summary);
    try {
      // 1. Документ на дату — или создаём на текущий период.
      let doc = await db.journalDocument.findFirst({
        where: {
          organizationId,
          templateId: tpl.id,
          status: "active",
          dateFrom: { lte: upToDate },
          dateTo: { gte: upToDate },
          ...buildingWhere(activeBuildingId),
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          config: true,
          responsibleUserId: true,
          responsibleTitle: true,
          verifierUserId: true,
          dateFrom: true,
          dateTo: true,
        },
      });
      if (!doc) {
        const created = await ensureActiveDocument(db, {
          organizationId,
          templateCode: tpl.code,
          now: upToDate,
          inheritResponsiblesFromLastDocument: true,
          buildingId: activeBuildingId,
        });
        // Журнал за этот период отправлен в закрытые: второй документ на тот же
        // период не заводим и закрытый не дозаполняем — пусть вернут его в активные.
        if (created.reason === "period-closed") {
          summary.skippedReason = "period_closed";
          continue;
        }
        if (!created.documentId) {
          summary.skippedReason = "no_document";
          continue;
        }
        summary.documentCreated = created.created;
        if (created.created) documentsCreated += 1;
        doc = await db.journalDocument.findUnique({
          where: { id: created.documentId },
          select: {
            id: true,
            title: true,
            config: true,
            responsibleUserId: true,
            responsibleTitle: true,
            verifierUserId: true,
            dateFrom: true,
            dateTo: true,
          },
        });
        if (!doc) {
          summary.skippedReason = "no_document";
          continue;
        }
      }
      summary.documentId = doc.id;
      summary.documentTitle = doc.title;

      // 2. Ответственный / проверяющий — по правилам должностей журнала,
      //    если не заданы или уже не в организации.
      const responsibleAlive =
        !!doc.responsibleUserId && aliveIds.has(doc.responsibleUserId);
      const verifierAlive =
        !!doc.verifierUserId && aliveIds.has(doc.verifierUserId);
      if (!responsibleAlive || !verifierAlive) {
        const picked = await prefillResponsiblesForNewDocument({
          organizationId,
          journalCode: tpl.code,
          baseConfig:
            doc.config && typeof doc.config === "object" && !Array.isArray(doc.config)
              ? (doc.config as Record<string, unknown>)
              : undefined,
        });
        const nextResponsible = responsibleAlive
          ? doc.responsibleUserId
          : picked.responsibleUserId;
        const nextVerifier = verifierAlive ? doc.verifierUserId : picked.verifierUserId;
        if (nextResponsible !== doc.responsibleUserId || nextVerifier !== doc.verifierUserId) {
          const titleUser = nextResponsible
            ? await db.user.findUnique({
                where: { id: nextResponsible },
                select: {
                  id: true,
                  name: true,
                  role: true,
                  positionTitle: true,
                  jobPosition: { select: { name: true, categoryKey: true } },
                },
              })
            : null;
          const responsibleTitle = titleUser
            ? getUserPositionLabel(titleUser) || null
            : doc.responsibleTitle;
          doc = await db.journalDocument.update({
            where: { id: doc.id },
            data: {
              responsibleUserId: nextResponsible,
              responsibleTitle,
              verifierUserId: nextVerifier,
              // Печатные формы: имена/должности в config из того же подбора.
              ...(responsibleAlive ? {} : { config: picked.config as never }),
            },
            select: {
              id: true,
              title: true,
              config: true,
              responsibleUserId: true,
              responsibleTitle: true,
              verifierUserId: true,
              dateFrom: true,
              dateTo: true,
            },
          });
          summary.responsiblesAssigned = true;
        }
      }

      // 3. Даты: от начала периода до upTo включительно.
      const periodFrom = utcDayStart(doc.dateFrom);
      const periodTo = utcDayStart(doc.dateTo);
      if (upToDate < periodFrom || upToDate > periodTo) {
        summary.skippedReason = "out_of_period";
        continue;
      }
      const dateKeys = buildDateKeys(periodFrom, upToDate);
      summary.days = dateKeys.length;

      const capability = getAutofillCapability(tpl.code);
      if (!capability) {
        summary.skippedReason = "unsupported";
        continue;
      }

      // Состав кадровых журналов: политика автоматики или «как в
      // последнем журнале» (прошлое успешное заполнение) + новички.
      let staffIds = employeeIds;
      if (capability === "staff") {
        const policy = getJournalAutomation(org, tpl.code).staff ?? { mode: "inherit" as const };
        const resolved = await resolveAutomationStaff(db, {
          organizationId,
          templateCode: tpl.code,
          staffPolicy: policy,
        });
        if (resolved.employeeIds.length > 0) staffIds = resolved.employeeIds;
        if (staffIds.length === 0) {
          summary.skippedReason = "no_employees";
          continue;
        }
      }

      const filled = await applyJournalAutoFill(db, {
        document: {
          id: doc.id,
          organizationId,
          templateCode: tpl.code,
          config: doc.config,
          responsibleUserId: doc.responsibleUserId,
          responsibleTitle: doc.responsibleTitle,
          dateFrom: doc.dateFrom,
          dateTo: doc.dateTo,
        },
        dateKeys,
        employeeIds: staffIds,
        users: employees,
        copyForward: true,
      });
      summary.filled = filled.created + filled.updated;
      totalFilled += summary.filled;
      if (filled.skipReasons.includes("no-responsible")) {
        summary.skippedReason = "no_responsible";
      } else if (filled.skipReasons.includes("no-employees")) {
        summary.skippedReason = "no_employees";
      } else if (filled.skipReasons.includes("unsupported")) {
        summary.skippedReason = "unsupported";
      }
    } catch (err) {
      console.error(`[close-day] ${tpl.code} failed`, err);
      summary.skippedReason = "error";
    }
  }

  // Сколько журналов реально что-то получили — для итога и журнала действий.
  const journalsFilled = summaries.filter((summary) => summary.filled > 0).length;

  await recordAuditLog({
    request,
    session,
    organizationId,
    action: "dashboard.close_day",
    entity: "journal_document",
    details: {
      filledCells: totalFilled,
      journalsFilled,
      documentsCreated,
      processed: summaries.length,
      upTo: upToKey,
      journals: summaries
        .filter((summary) => summary.filled > 0)
        .map((summary) => summary.templateName),
    },
  });

  return NextResponse.json({
    totalFilled,
    journalsFilled,
    documentsCreated,
    processed: summaries.length,
    upToKey,
    todayKey,
    summaries,
  });
}

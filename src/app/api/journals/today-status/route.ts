import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { getActiveBuildingId } from "@/lib/active-building";
import { buildingWhere } from "@/lib/building-scope";
import { hasCapability } from "@/lib/permission-presets";
import {
  DAILY_JOURNAL_CODES,
  CONFIG_DAILY_CODES,
} from "@/lib/today-compliance";
import { COUNTS_UNBOUNDED_CODES } from "@/lib/daily-journal-codes";
import {
  getTasksFlowReadinessByTemplate,
  resolveDayStart,
  rollupConfigDocumentForDay,
} from "@/lib/today-compliance";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/journals/today-status
 *
 * Возвращает статус каждого daily-журнала за сегодня:
 *   - untouched: ноль реальных записей за сегодня (только _autoSeeded
 *     болванки или пусто). И TasksFlow тасков нет / 0 выполнено.
 *   - in_progress: есть хотя бы одна реальная запись за сегодня, но
 *     не все нужные → журнал «начали заполнять».
 *   - completed: все TF-таски выполнены за сегодня ИЛИ заполненность
 *     по entries дотягивает до полной.
 *
 * Используется страницей /journals-progress (контрольная панель
 * заведующей).
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (
    !hasCapability(session.user, "tasks.verify") &&
    !hasCapability(session.user, "admin.full")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);

  // «Сегодня» — в поясе организации, как на дашборде: на проде процесс
  // живёт в UTC, и ночью по Москве UTC-день — это ещё вчера.
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true, disabledJournalCodes: true },
  });
  const disabledCodes = parseDisabledCodes(org?.disabledJournalCodes);
  const now = new Date();
  const todayStart = resolveDayStart(org?.timezone ?? null, now);
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
  const todayKey = todayStart.toISOString().slice(0, 10);

  // 1. Активные документы daily-журналов сегодня.
  const activeDocs = await db.journalDocument.findMany({
    where: {
      organizationId,
      status: "active",
      dateFrom: { lte: todayStart },
      dateTo: { gte: todayStart },
      ...buildingWhere(await getActiveBuildingId(session)),
    },
    select: {
      id: true,
      templateId: true,
      config: true,
      template: { select: { code: true, name: true } },
    },
  });

  // 2. Считаем сегодняшние real-entries (без _autoSeeded маркера) для
  // каждого активного документа.
  const docIds = activeDocs.map((d) => d.id);
  let realByDoc = new Map<string, number>();
  let totalByDoc = new Map<string, number>();
  if (docIds.length > 0) {
    const real = await db.journalDocumentEntry.groupBy({
      by: ["documentId"],
      where: {
        documentId: { in: docIds },
        date: { gte: todayStart, lt: todayEnd },
        ...NOT_AUTO_SEEDED,
      },
      _count: { _all: true },
    });
    realByDoc = new Map(real.map((r) => [r.documentId, r._count._all]));

    const total = await db.journalDocumentEntry.groupBy({
      by: ["documentId"],
      where: {
        documentId: { in: docIds },
        date: { gte: todayStart, lt: todayEnd },
      },
      _count: { _all: true },
    });
    totalByDoc = new Map(total.map((r) => [r.documentId, r._count._all]));
  }

  // 3. TasksFlow readiness per-template: completedCount / totalCount.
  const tfReadiness = await getTasksFlowReadinessByTemplate(
    organizationId,
    todayStart,
    activeDocs.map((d) => ({ id: d.id, templateId: d.templateId }))
  );

  // 4. Группируем по templateId.
  type TemplateAcc = {
    code: string;
    name: string;
    realCount: number;
    totalCount: number;
    docIds: string[];
  };
  const byTemplate = new Map<string, TemplateAcc>();
  for (const doc of activeDocs) {
    if (disabledCodes.has(doc.template.code)) continue;
    const acc = byTemplate.get(doc.templateId) ?? {
      code: doc.template.code,
      name: doc.template.name,
      realCount: 0,
      totalCount: 0,
      docIds: [],
    };
    if (CONFIG_DAILY_CODES.has(doc.template.code)) {
      // Уборка и бракеражи держат строки внутри `config`, а не в
      // JournalDocumentEntry: без этого они всегда «пока пусто», хотя
      // на дашборде тот же журнал уже зелёный.
      const rollup = rollupConfigDocumentForDay(
        doc.template.code,
        doc.config,
        todayKey
      );
      const todayCount = rollup?.todayCount ?? 0;
      acc.realCount += todayCount;
      // У бракеражей ростера нет — каждая строка это событие. Их
      // «сколько ожидается» = сколько уже внесли, иначе в сетке
      // появлялось бы «0 из 9», где 9 — это число документов.
      acc.totalCount += COUNTS_UNBOUNDED_CODES.has(doc.template.code)
        ? todayCount
        : (rollup?.expectedCount ?? 0);
    } else {
      acc.realCount += realByDoc.get(doc.id) ?? 0;
      acc.totalCount += totalByDoc.get(doc.id) ?? 0;
    }
    acc.docIds.push(doc.id);
    byTemplate.set(doc.templateId, acc);
  }

  // 5. Классификация.
  type Status = "untouched" | "in_progress" | "completed";
  type Item = {
    code: string;
    name: string;
    status: Status;
    realCount: number;
    totalCount: number;
    tfCompleted: number;
    tfTotal: number;
    primaryDocumentId: string | null;
  };
  const items: Item[] = [];

  for (const [templateId, acc] of byTemplate.entries()) {
    const isDaily =
      DAILY_JOURNAL_CODES.has(acc.code) || CONFIG_DAILY_CODES.has(acc.code);
    if (!isDaily) continue;

    const tf = tfReadiness.get(templateId);
    const tfTotal = tf?.totalCount ?? 0;
    const tfCompleted = tf?.doneTodayCount ?? 0;

    let status: Status;
    // Completed: все TF-таски выполнены ИЛИ все entries заполнены.
    const tfFullyDone = tfTotal > 0 && tfCompleted >= tfTotal;
    const entriesFullyDone =
      acc.totalCount > 0 && acc.realCount >= acc.totalCount;
    if (tfFullyDone || entriesFullyDone) {
      status = "completed";
    } else if (acc.realCount > 0 || tfCompleted > 0) {
      status = "in_progress";
    } else {
      status = "untouched";
    }

    items.push({
      code: acc.code,
      name: acc.name,
      status,
      realCount: acc.realCount,
      totalCount: acc.totalCount,
      tfCompleted,
      tfTotal,
      primaryDocumentId: acc.docIds[0] ?? null,
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return NextResponse.json({
    items,
    counts: {
      untouched: items.filter((i) => i.status === "untouched").length,
      in_progress: items.filter((i) => i.status === "in_progress").length,
      completed: items.filter((i) => i.status === "completed").length,
    },
  });
}

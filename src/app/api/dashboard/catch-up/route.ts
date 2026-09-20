import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getActiveBuildingId } from "@/lib/active-building";
import { buildingWhere } from "@/lib/building-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { DAILY_JOURNAL_CODES } from "@/lib/daily-journal-codes";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { resolveDayStart } from "@/lib/today-compliance";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 14;

function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toPrismaJsonValue(
  value: unknown
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

type DayStatus =
  | "filled"
  | "missing"
  | "out_of_period"
  | "future"
  | "no_document";

type JournalRow = {
  templateCode: string;
  templateName: string;
  documentId: string | null;
  documentTitle: string | null;
  expectedRoster: number;
  days: { date: string; status: DayStatus; filledCount: number }[];
};

/**
 * GET /api/dashboard/catch-up
 *
 * Возвращает grid за последние WINDOW_DAYS дней (включая сегодня) по
 * всем ежедневным JournalDocumentEntry-журналам с активным документом.
 * Каждая ячейка — статус (filled/missing/out_of_period/future/no_document)
 * + сколько строк уже есть и сколько ожидается (expectedRoster).
 *
 * `expectedRoster` для строгих журналов (hygiene/health_check) считается
 * как количество разных employeeId среди строк документа за весь его
 * период — это даёт реалистичное «X из Y». Для остальных журналов
 * roster=0 (ожидаем хотя бы одну строку за день).
 */

/**
 * POST /api/dashboard/catch-up
 *
 * Заполняет указанные (documentId, date) пары копированием из
 * ближайшего непустого дня до целевой даты в этом же документе.
 * Если в документе вообще нет ни одной записи — пропускаем.
 *
 * Body: { targets: Array<{ documentId: string; date: string (YYYY-MM-DD) }> }
 *
 * Идемпотентно по (employeeId, date) — уже заполненные строки
 * сохраняются.
 */

export async function GET() {
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
  const organizationId = getActiveOrgId(session);

  // «Сегодня» — в поясе организации, как на дашборде: иначе ночью по
  // Москве последний столбец сетки — вчерашний день.
  const orgDay = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const today = resolveDayStart(orgDay?.timezone ?? null, new Date());
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (WINDOW_DAYS - 1));

  const codes = [...DAILY_JOURNAL_CODES];
  const templates = await db.journalTemplate.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, name: true },
  });

  const docs = await db.journalDocument.findMany({
    where: {
      organizationId,
      status: "active",
      templateId: { in: templates.map((t) => t.id) },
      ...buildingWhere(await getActiveBuildingId(session)),
    },
    select: {
      id: true,
      title: true,
      templateId: true,
      dateFrom: true,
      dateTo: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Pick one freshest active doc per template.
  const freshDoc = new Map<string, (typeof docs)[number]>();
  for (const d of docs) {
    if (!freshDoc.has(d.templateId)) freshDoc.set(d.templateId, d);
  }

  const docIds = [...freshDoc.values()].map((d) => d.id);
  // _autoSeeded плейсхолдеры — пустые матриксы для employee×day,
  // их в counter «заполнено сегодня» включать нельзя: иначе вся
  // catch-up grid показывает «filled» там, где сотрудник реально
  // ничего не вписал.
  const entries =
    docIds.length === 0
      ? []
      : await db.journalDocumentEntry.findMany({
          where: {
            documentId: { in: docIds },
            date: { gte: start, lte: today },
            ...NOT_AUTO_SEEDED,
          },
          select: { documentId: true, date: true, employeeId: true },
        });

  const entriesByDoc = new Map<string, Map<string, Set<string>>>();
  for (const e of entries) {
    const docMap =
      entriesByDoc.get(e.documentId) ?? new Map<string, Set<string>>();
    if (!entriesByDoc.has(e.documentId)) entriesByDoc.set(e.documentId, docMap);
    const k = dayKey(e.date);
    const set = docMap.get(k) ?? new Set<string>();
    set.add(e.employeeId);
    docMap.set(k, set);
  }

  // Roster size = distinct employees ever filled this doc.
  const rosterByDoc = new Map<string, number>();
  if (docIds.length > 0) {
    const rosterRows = await db.journalDocumentEntry.findMany({
      where: { documentId: { in: docIds } },
      select: { documentId: true, employeeId: true },
      distinct: ["documentId", "employeeId"],
    });
    for (const r of rosterRows) {
      rosterByDoc.set(r.documentId, (rosterByDoc.get(r.documentId) ?? 0) + 1);
    }
  }

  const days: Date[] = [];
  for (let i = 0; i < WINDOW_DAYS; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    days.push(d);
  }

  const rows: JournalRow[] = templates.map((tpl) => {
    const doc = freshDoc.get(tpl.id) ?? null;
    if (!doc) {
      return {
        templateCode: tpl.code,
        templateName: tpl.name,
        documentId: null,
        documentTitle: null,
        expectedRoster: 0,
        days: days.map((d) => ({
          date: dayKey(d),
          status: "no_document" as DayStatus,
          filledCount: 0,
        })),
      };
    }
    const dateFrom = utcDayStart(doc.dateFrom);
    const dateToEnd = (() => {
      const e = utcDayStart(doc.dateTo);
      e.setUTCDate(e.getUTCDate() + 1);
      return e;
    })();
    const docEntries = entriesByDoc.get(doc.id) ?? new Map();

    return {
      templateCode: tpl.code,
      templateName: tpl.name,
      documentId: doc.id,
      documentTitle: doc.title,
      expectedRoster: rosterByDoc.get(doc.id) ?? 0,
      days: days.map((d) => {
        const k = dayKey(d);
        const filledSet = docEntries.get(k) as Set<string> | undefined;
        const filledCount = filledSet?.size ?? 0;
        if (d > today)
          return { date: k, status: "future" as DayStatus, filledCount };
        if (d < dateFrom || d >= dateToEnd)
          return { date: k, status: "out_of_period" as DayStatus, filledCount };
        return {
          date: k,
          status: filledCount > 0
            ? ("filled" as DayStatus)
            : ("missing" as DayStatus),
          filledCount,
        };
      }),
    };
  });

  return NextResponse.json({
    windowDays: WINDOW_DAYS,
    days: days.map((d) => dayKey(d)),
    rows,
  });
}

type PostBody = {
  targets?: { documentId: string; date: string }[];
};

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
  const organizationId = getActiveOrgId(session);
  const body = (await request.json().catch(() => ({}))) as PostBody;
  const targets = Array.isArray(body?.targets) ? body.targets : [];
  if (targets.length === 0) {
    return NextResponse.json(
      { error: "Не выбраны строки для заполнения" },
      { status: 400 }
    );
  }

  // Group by documentId.
  const byDoc = new Map<string, Set<string>>();
  for (const t of targets) {
    if (!t || typeof t.documentId !== "string" || typeof t.date !== "string")
      continue;
    const set = byDoc.get(t.documentId) ?? new Set<string>();
    set.add(t.date);
    byDoc.set(t.documentId, set);
  }

  const docs = await db.journalDocument.findMany({
    where: {
      id: { in: [...byDoc.keys()] },
      organizationId,
      status: "active",
    },
    select: { id: true, dateFrom: true, dateTo: true, templateId: true },
  });
  const docMap = new Map(docs.map((d) => [d.id, d]));

  type Result = {
    documentId: string;
    date: string;
    copied: number;
    sourceDate?: string;
    skippedReason?:
      | "no_source"
      | "out_of_period"
      | "doc_not_found"
      | "already_filled";
  };
  const results: Result[] = [];
  let totalCopied = 0;

  for (const [documentId, dateSet] of byDoc) {
    const doc = docMap.get(documentId);
    if (!doc) {
      for (const date of dateSet)
        results.push({
          documentId,
          date,
          copied: 0,
          skippedReason: "doc_not_found",
        });
      continue;
    }
    const dateFrom = utcDayStart(doc.dateFrom);
    const dateToEnd = (() => {
      const e = utcDayStart(doc.dateTo);
      e.setUTCDate(e.getUTCDate() + 1);
      return e;
    })();

    for (const dateStr of dateSet) {
      const target = new Date(`${dateStr}T00:00:00.000Z`);
      if (Number.isNaN(target.getTime())) continue;
      const targetUtc = utcDayStart(target);

      if (targetUtc < dateFrom || targetUtc >= dateToEnd) {
        results.push({
          documentId,
          date: dateStr,
          copied: 0,
          skippedReason: "out_of_period",
        });
        continue;
      }

      // Find nearest prior day with REAL entries (within document period).
      // Без NOT_AUTO_SEEDED catch-up мог скопировать пустую seeded-row
      // как «вчерашнее заполнение», и UI показал бы catch-up'нутый
      // день «заполненным» без реальных данных.
      const prior = await db.journalDocumentEntry.findFirst({
        where: {
          documentId,
          date: { lt: targetUtc, gte: dateFrom },
          ...NOT_AUTO_SEEDED,
        },
        orderBy: { date: "desc" },
        select: { date: true },
      });
      if (!prior) {
        results.push({
          documentId,
          date: dateStr,
          copied: 0,
          skippedReason: "no_source",
        });
        continue;
      }
      const sourceUtc = utcDayStart(prior.date);

      const [sourceEntries, targetEntries] = await Promise.all([
        db.journalDocumentEntry.findMany({
          where: { documentId, date: sourceUtc, ...NOT_AUTO_SEEDED },
          select: { employeeId: true, data: true },
        }),
        db.journalDocumentEntry.findMany({
          where: { documentId, date: targetUtc, ...NOT_AUTO_SEEDED },
          select: { employeeId: true },
        }),
      ]);
      const filledSet = new Set(targetEntries.map((e) => e.employeeId));

      let copied = 0;
      for (const e of sourceEntries) {
        if (filledSet.has(e.employeeId)) continue;
        await db.journalDocumentEntry.upsert({
          where: {
            documentId_employeeId_date: {
              documentId,
              employeeId: e.employeeId,
              date: targetUtc,
            },
          },
          create: {
            documentId,
            employeeId: e.employeeId,
            date: targetUtc,
            data: toPrismaJsonValue(e.data),
          },
          update: { data: toPrismaJsonValue(e.data) },
        });
        copied += 1;
      }
      totalCopied += copied;
      results.push({
        documentId,
        date: dateStr,
        copied,
        sourceDate: dayKey(sourceUtc),
        ...(copied === 0 && filledSet.size > 0
          ? { skippedReason: "already_filled" as const }
          : {}),
      });
    }
  }

  await logAudit({
    organizationId,
    userId: session.user.id,
    userName: session.user.name ?? undefined,
    action: "journal_entry.copy",
    entity: "journal_document",
    details: {
      via: "dashboard.catch_up",
      totalCopied,
      processed: results.length,
    },
  });

  return NextResponse.json({ totalCopied, results });
}

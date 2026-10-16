import { z } from "zod";
import { db } from "@/lib/db";
import { journalTitle } from "@/i18n/journal-presentation";
import { loadMessages } from "@/i18n/messages";
import { assistantFillCellsSchema, executeProposedAction, prepareAction } from "@/lib/ai-assistant/actions";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";
import { isConfigWriterJournal } from "@/lib/external/dispatch";
import { toDateKey } from "@/lib/hygiene-document";
import { getAllowedJournalCodes, hasJournalAccess } from "@/lib/journal-acl";
import { orgTodayKey } from "@/lib/timezone";
import { CONFIG_DAILY_CODES, DAILY_JOURNAL_CODES, getTemplatesFilledToday } from "@/lib/today-compliance";
import type { ApiCallContext } from "../context";
import { capList, clampRange, instantForDateKey, resolveDateKey } from "../dates";
import { toolError, toolOk, type ApiTool } from "./types";

const MAX_ENTRIES = 2000;
const MAX_CONFIG_CHARS = 30_000;

/**
 * Журнал-сетка: строки — ячейки сотрудник × день (`JournalDocumentEntry`).
 * Остальные журналы хранят строки в `config` документа — их ИИ в v1
 * только читает.
 */
export function isCellJournal(code: string): boolean {
  return !CONFIG_DAILY_CODES.has(code) && !isConfigWriterJournal(code);
}

function documentUrl(ctx: ApiCallContext, code: string, documentId: string): string {
  return `${ctx.baseUrl}/journals/${code}/documents/${documentId}`;
}

/**
 * Журнал, выключенный организацией, для ИИ не существует — и в списке,
 * и по известному id (ответ как на чужой документ, чтобы не раскрывать).
 */
async function isJournalDisabled(ctx: ApiCallContext, code: string): Promise<boolean> {
  return code !== "" && (await getDisabledJournalCodes(ctx.orgId)).has(code);
}

function aclActor(ctx: ApiCallContext) {
  return { id: ctx.actor.id, role: ctx.actor.role, isRoot: false };
}

const dateField = z.string().max(10).describe("Дата YYYY-MM-DD; по умолчанию — сегодня в часовом поясе организации");

export const listJournalsTool: ApiTool = {
  name: "list_journals",
  title: "Журналы на дату",
  description:
    "Журналы организации на дату: заполнен ли каждый ежедневный журнал, активные документы с id и ссылками. Ответ на вопрос «что сегодня не заполнено».",
  access: "read",
  input: z.object({ date: dateField.optional() }),
  rest: { method: "GET", path: "/journals" },
  async handler(input: { date?: string }, ctx) {
    const resolved = resolveDateKey(input.date, ctx.timezone);
    if (!resolved.ok) return toolError(422, resolved.error);
    const date = resolved.dateKey;

    const [disabled, allowed, templates, messages] = await Promise.all([
      getDisabledJournalCodes(ctx.orgId),
      getAllowedJournalCodes(aclActor(ctx)),
      db.journalTemplate.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, code: true, name: true },
      }),
      loadMessages(ctx.locale),
    ]);
    const visible = templates.filter(
      (t) => !disabled.has(t.code) && (allowed === null || allowed.includes(t.code))
    );
    // Документы хранят границы периода UTC-полуночью — как в /api/external/summary.
    const day = new Date(`${date}T00:00:00.000Z`);
    const [filled, documents] = await Promise.all([
      getTemplatesFilledToday(
        ctx.orgId,
        instantForDateKey(date),
        visible.map((t) => ({ id: t.id, code: t.code })),
        disabled,
        { treatAperiodicAsFilled: false }
      ),
      db.journalDocument.findMany({
        where: {
          organizationId: ctx.orgId,
          status: "active",
          dateFrom: { lte: day },
          dateTo: { gte: day },
          templateId: { in: visible.map((t) => t.id) },
        },
        orderBy: { dateFrom: "desc" },
        select: {
          id: true,
          title: true,
          dateFrom: true,
          dateTo: true,
          status: true,
          templateId: true,
          building: { select: { name: true } },
        },
      }),
    ]);

    const journals = visible.map((t) => {
      const daily = DAILY_JOURNAL_CODES.has(t.code) || CONFIG_DAILY_CODES.has(t.code);
      return {
        code: t.code,
        name: journalTitle(ctx.locale, messages.journals.names, t.code, t.name),
        daily,
        filled: filled.has(t.id),
        storage: isCellJournal(t.code) ? ("cells" as const) : ("document" as const),
        documents: documents
          .filter((d) => d.templateId === t.id)
          .map((d) => ({
            id: d.id,
            title: d.title,
            periodFrom: toDateKey(d.dateFrom),
            periodTo: toDateKey(d.dateTo),
            status: d.status,
            point: d.building?.name ?? null,
            url: documentUrl(ctx, t.code, d.id),
          })),
      };
    });
    const dailyJournals = journals.filter((j) => j.daily);
    return toolOk({
      date,
      journals,
      summary: {
        dailyTotal: dailyJournals.length,
        dailyFilled: dailyJournals.filter((j) => j.filled).length,
        notFilled: dailyJournals.filter((j) => !j.filled).map((j) => j.name),
      },
    });
  },
};

export const getJournalDocumentTool: ApiTool = {
  name: "get_journal_document",
  title: "Записи документа",
  description:
    "Записи документа журнала за период (до 31 дня): ячейки сотрудник × день с данными. Для журналов-конфигов (storage = document) — содержимое документа.",
  access: "read",
  input: z.object({
    documentId: z.string().min(1).max(100).describe("id документа из list_journals → documents"),
    from: z.string().max(10).optional().describe("Начало периода YYYY-MM-DD; по умолчанию — 7 дней до сегодня"),
    to: z.string().max(10).optional().describe("Конец периода YYYY-MM-DD"),
  }),
  rest: { method: "GET", path: "/documents/{documentId}" },
  async handler(input: { documentId: string; from?: string; to?: string }, ctx) {
    const doc = await db.journalDocument.findFirst({
      where: { id: input.documentId, organizationId: ctx.orgId },
      select: {
        id: true,
        title: true,
        dateFrom: true,
        dateTo: true,
        status: true,
        config: true,
        template: { select: { code: true, name: true } },
        building: { select: { name: true } },
      },
    });
    const code = doc?.template?.code ?? "";
    if (!doc || (await isJournalDisabled(ctx, code))) return toolError(404, "Документ не найден.");
    if (code && !(await hasJournalAccess(aclActor(ctx), code))) {
      return toolError(403, "Нет доступа к этому журналу.");
    }

    const range = clampRange({
      from: input.from,
      to: input.to,
      todayKey: orgTodayKey(ctx.timezone ?? undefined),
      docFrom: toDateKey(doc.dateFrom),
      docTo: toDateKey(doc.dateTo),
      defaultDays: 7,
      maxDays: 31,
    });
    if (!range.ok) return toolError(422, range.error);

    const rows = await db.journalDocumentEntry.findMany({
      where: {
        documentId: doc.id,
        date: { gte: new Date(`${range.from}T00:00:00.000Z`), lte: new Date(`${range.to}T00:00:00.000Z`) },
      },
      orderBy: [{ date: "asc" }, { employeeId: "asc" }],
      take: MAX_ENTRIES + 1,
      select: { date: true, employeeId: true, data: true },
    });
    const capped = capList(rows, MAX_ENTRIES);
    const employeeIds = [...new Set(capped.items.map((r) => r.employeeId))];
    const employees = employeeIds.length
      ? await db.user.findMany({
          where: { id: { in: employeeIds }, organizationId: ctx.orgId },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(employees.map((e) => [e.id, e.name]));
    const messages = await loadMessages(ctx.locale);

    const data: Record<string, unknown> = {
      document: {
        id: doc.id,
        title: doc.title,
        journalCode: code,
        journalName: journalTitle(ctx.locale, messages.journals.names, code, doc.template?.name ?? code),
        periodFrom: toDateKey(doc.dateFrom),
        periodTo: toDateKey(doc.dateTo),
        status: doc.status,
        point: doc.building?.name ?? null,
        url: documentUrl(ctx, code, doc.id),
      },
      range: { from: range.from, to: range.to },
      entries: capped.items.map((r) => ({
        date: toDateKey(r.date),
        employeeId: r.employeeId,
        employeeName: nameById.get(r.employeeId) ?? null,
        data: r.data,
      })),
      truncated: capped.truncated,
    };
    if (code && !isCellJournal(code)) {
      const serialized = JSON.stringify(doc.config ?? null);
      if (serialized.length <= MAX_CONFIG_CHARS) data.config = doc.config ?? null;
      else data.configTruncated = true;
    }
    return toolOk(data);
  },
};

export const fillJournalCellsTool: ApiTool = {
  name: "fill_journal_cells",
  title: "Заполнить ячейки журнала",
  description:
    "Заполнить ячейки журнала-сетки (storage = cells): сотрудники × даты. Значения замеров — только названные пользователем. Права, закрытые дни и документы проверяются как в интерфейсе.",
  access: "write",
  input: assistantFillCellsSchema,
  rest: { method: "POST", path: "/documents/{documentId}/cells" },
  async handler(input: z.infer<typeof assistantFillCellsSchema>, ctx) {
    const doc = await db.journalDocument.findFirst({
      where: { id: input.documentId, organizationId: ctx.orgId },
      select: { id: true, template: { select: { code: true, name: true } } },
    });
    const code = doc?.template?.code ?? "";
    if (!doc || (await isJournalDisabled(ctx, code))) return toolError(404, "Документ не найден.");
    const url = documentUrl(ctx, code, doc.id);
    if (!isCellJournal(code)) {
      const messages = await loadMessages(ctx.locale);
      const name = journalTitle(ctx.locale, messages.journals.names, code, doc.template?.name ?? code);
      return toolError(
        422,
        `Журнал «${name}» хранит записи внутри документа — через ИИ его пока не заполнить. Откройте: ${url}`
      );
    }

    const actionCtx = { orgId: ctx.orgId, actor: ctx.actor, locale: ctx.locale };
    const prepared = await prepareAction({ kind: "fill_journal_cells", input }, actionCtx);
    if (!prepared.ok) return toolError(422, prepared.error);
    const result = await executeProposedAction({ kind: "fill_journal_cells", input }, actionCtx, { audit: false });
    if (!result.ok) return toolError(422, result.error);
    return toolOk({ summary: result.summary, details: prepared.preview.details, url }, result.summary);
  },
};

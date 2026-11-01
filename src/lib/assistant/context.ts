import { db } from "@/lib/db";
import { ASSISTANT_HISTORY_LIMIT } from "@/lib/assistant/store";
import {
  documentWorkerScopeWhere,
  journalEntryWorkerScopeWhere,
  loadManagerPointScope,
  personWorkerScopeWhere,
} from "@/lib/worker-point-scope";

/**
 * База знаний, которую видит ассистент.
 *
 * Всё берётся из БД прямой выборкой — ни векторного поиска, ни
 * эмбеддингов. На нашем масштабе (десятки журналов, сотни записей у
 * организации) выборка проще, дешевле и, главное, точнее: ассистент
 * отвечает по фактическим данным, а не по похожему тексту.
 *
 * Ключевое ограничение проходит ЗДЕСЬ, а не в промпте: организация
 * берётся из диалога по токену, и в каждый запрос подставляется
 * `organizationId`. Модель физически не получает чужих данных, даже если
 * её уговорят их попросить. Промпт можно обойти уговором, выборку — нет.
 */

/** Сколько записей журнала показываем в срезе. */
const RECENT_ENTRIES = 20;
/** Сколько документов-бланков перечисляем. */
const RECENT_DOCUMENTS = 20;

export type AssistantContext = Awaited<ReturnType<typeof buildAssistantContext>>;

export async function buildAssistantContext(args: {
  organizationId: string;
  userId: string;
  conversationId: string;
}) {
  // Человеку точки — только документы, записи и люди его точек (аудит 2026-11-01).
  const scope = await loadManagerPointScope(args.organizationId, args.userId);
  const [organization, user, templates, documents, entries, history] =
    await Promise.all([
      db.organization.findUnique({
        where: { id: args.organizationId },
        select: {
          name: true,
          subscriptionPlan: true,
          subscriptionEnd: true,
          createdAt: true,
        },
      }),
      db.user.findUnique({
        where: { id: args.userId },
        select: { name: true, role: true, email: true },
      }),
      db.journalTemplate.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: {
          code: true,
          name: true,
          description: true,
          isMandatorySanpin: true,
          isMandatoryHaccp: true,
          fillMode: true,
        },
      }),
      db.journalDocument.findMany({
        where: { organizationId: args.organizationId, ...documentWorkerScopeWhere(scope) },
        orderBy: { createdAt: "desc" },
        take: RECENT_DOCUMENTS,
        select: {
          id: true,
          title: true,
          dateFrom: true,
          dateTo: true,
          status: true,
          autoFill: true,
          template: { select: { code: true, name: true } },
        },
      }),
      db.journalEntry.findMany({
        where: { organizationId: args.organizationId, ...journalEntryWorkerScopeWhere(scope) },
        orderBy: { createdAt: "desc" },
        take: RECENT_ENTRIES,
        select: {
          id: true,
          createdAt: true,
          template: { select: { code: true, name: true } },
        },
      }),
      db.assistantMessage.findMany({
        where: { conversationId: args.conversationId, status: "done" },
        orderBy: { createdAt: "asc" },
        take: ASSISTANT_HISTORY_LIMIT,
        select: { role: true, content: true },
      }),
    ]);

  const staffCount = await db.user.count({
    where: { organizationId: args.organizationId, isActive: true, ...personWorkerScopeWhere(scope) },
  });

  return {
    today: new Date().toISOString().slice(0, 10),
    organization: organization
      ? {
          name: organization.name,
          plan: organization.subscriptionPlan,
          planEndsAt: organization.subscriptionEnd?.toISOString() ?? null,
          staffCount,
        }
      : null,
    // Кто спрашивает: от роли зависит и ответ. Уборщице бесполезно
    // рассказывать, как настраивать права, — она их не видит.
    asker: user
      ? { name: user.name, role: user.role, email: user.email }
      : null,
    journals: templates.map((item) => ({
      code: item.code,
      name: item.name,
      description: item.description,
      mandatory: item.isMandatorySanpin || item.isMandatoryHaccp,
      fillMode: item.fillMode,
    })),
    documents: documents.map((item) => ({
      id: item.id,
      title: item.title,
      journal: item.template?.name ?? null,
      journalCode: item.template?.code ?? null,
      periodFrom: item.dateFrom.toISOString().slice(0, 10),
      periodTo: item.dateTo.toISOString().slice(0, 10),
      status: item.status,
      autoFill: item.autoFill,
    })),
    recentEntries: entries.map((item) => ({
      journal: item.template?.name ?? null,
      journalCode: item.template?.code ?? null,
      createdAt: item.createdAt.toISOString(),
    })),
    history: history.map((item) => ({
      role: item.role,
      content: item.content,
    })),
  };
}

import type { PrismaClient } from "@prisma/client";

import { emitWebhook } from "@/lib/webhooks/dispatch";
import { webhookPointFields } from "@/lib/webhooks/point";

import { publishToOrganization, type LiveEvent } from "@/lib/live-events";

/**
 * Событие «в журналах что-то изменилось» — одно на все ~40 путей записи.
 *
 * Дашборд, список журналов, доска контроля и главная Mini App показывают
 * «сегодня осталось N из M» и карточки журналов. Раньше эти цифры жили
 * до следующего опроса (30–60 с) или до перезагрузки: сотрудник
 * отметился с телефона, а руководитель этого не видел.
 *
 * Вешать событие в каждый путь записи нельзя — их сорок, включая кроны,
 * TasksFlow-адаптеры и IoT, и новый путь забыл бы про событие. Поэтому
 * хук стоит на уровне Prisma (`src/lib/db.ts`): любая запись в
 * `JournalEntry`, `JournalDocumentEntry`, `JournalDocument` проходит
 * через `notifyJournalWrite`. Здесь — чистая часть: что можно понять из
 * аргументов запроса без похода в базу, и как склеить очередь событий.
 *
 * Правила:
 * - запись в журнал не должна ждать событие и не может от него упасть:
 *   всё best-effort, ошибки только в console.error;
 * - событие — сигнал «перечитай», данных в нём нет (см. live-events.ts),
 *   только коды журналов и id документов, чтобы экран мог решить,
 *   его ли это касается;
 * - события одной организации склеиваются: «Отметить всех» пишет
 *   двадцать строк, а вкладок это касается один раз.
 */

export type JournalModel = "journalEntry" | "journalDocumentEntry" | "journalDocument";

const WRITE_OPERATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

export function isJournalWriteOperation(operation: string): boolean {
  return WRITE_OPERATIONS.has(operation);
}

/** Что удалось понять о записи из аргументов и результата запроса. */
export type JournalWriteHint = {
  organizationId?: string;
  templateId?: string;
  documentId?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** `{ in: [...] }` из where-фильтра — список id, иначе пусто. */
function idList(value: unknown): string[] {
  const direct = asId(value);
  if (direct) return [direct];
  const list = asRecord(value)?.in;
  return Array.isArray(list) ? list.map(asId).filter((v): v is string => Boolean(v)) : [];
}

/** `{ connect: { id } }` из data — id связанной сущности. */
function connectedId(value: unknown): string | undefined {
  return asId(asRecord(asRecord(value)?.connect)?.id);
}

function hintsFromSource(
  model: JournalModel,
  source: Record<string, unknown> | null
): JournalWriteHint[] {
  if (!source) return [];

  const organizationIds = [
    ...idList(source.organizationId),
    ...(connectedId(source.organization) ? [connectedId(source.organization)!] : []),
    // where: { document: { organizationId } } — фильтр по связи
    ...idList(asRecord(source.document)?.organizationId),
  ];
  const templateId =
    asId(source.templateId) ??
    connectedId(source.template) ??
    asId(asRecord(source.document)?.templateId);
  const documentIds = [
    ...idList(source.documentId),
    ...(connectedId(source.document) ? [connectedId(source.document)!] : []),
    // upsert по составному ключу: { documentId_employeeId_date: { documentId } }
    ...idList(asRecord(source.documentId_employeeId_date)?.documentId),
    // Для самого документа его id — это и есть documentId.
    ...(model === "journalDocument" ? idList(source.id) : []),
  ];

  const hints: JournalWriteHint[] = [];
  const orgs = organizationIds.length > 0 ? organizationIds : [undefined];
  const docs = documentIds.length > 0 ? documentIds : [undefined];
  for (const organizationId of orgs) {
    for (const documentId of docs) {
      const hint: JournalWriteHint = {};
      if (organizationId) hint.organizationId = organizationId;
      if (templateId) hint.templateId = templateId;
      if (documentId) hint.documentId = documentId;
      if (Object.keys(hint).length > 0) hints.push(hint);
    }
  }
  return hints;
}

/**
 * Извлечь подсказки из аргументов Prisma-запроса и его результата.
 * Смотрим результат (полная строка, если не было `select`), `data`,
 * `where`, `create`/`update` (upsert) и массив `data` у createMany.
 * Пусто — событие не отправится, страховочный опрос догонит.
 */
export function extractJournalWriteHints(
  model: JournalModel,
  args: unknown,
  result: unknown
): JournalWriteHint[] {
  const sources: (Record<string, unknown> | null)[] = [];
  const push = (value: unknown) => {
    if (Array.isArray(value)) {
      // createManyAndReturn / createMany — хватит первых строк: они
      // все из одного документа или организации.
      for (const item of value.slice(0, 20)) sources.push(asRecord(item));
    } else {
      sources.push(asRecord(value));
    }
  };
  push(result);
  const record = asRecord(args);
  if (record) {
    push(record.data);
    push(record.where);
    push(record.create);
    push(record.update);
  }

  const seen = new Set<string>();
  const hints: JournalWriteHint[] = [];
  for (const source of sources) {
    for (const hint of hintsFromSource(model, source)) {
      const key = `${hint.organizationId ?? ""}|${hint.templateId ?? ""}|${hint.documentId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hints.push(hint);
    }
  }
  // Результат знает больше, чем `data`: {org, template, document} против
  // {org, template}. Подсказка, целиком входящая в другую, — лишняя.
  return hints.filter(
    (hint) => !hints.some((other) => other !== hint && isSubsetHint(hint, other))
  );
}

function isSubsetHint(hint: JournalWriteHint, other: JournalWriteHint): boolean {
  const keys = ["organizationId", "templateId", "documentId"] as const;
  const defined = keys.filter((key) => hint[key] !== undefined);
  if (defined.length === keys.filter((key) => other[key] !== undefined).length) return false;
  return defined.every((key) => hint[key] === other[key]);
}

// ---------------------------------------------------------------------------
// Подсказка → организация и код журнала (с кешем, документ свою
// организацию не меняет)
// ---------------------------------------------------------------------------

export type JournalChange = {
  organizationId: string;
  code: string | null;
  documentId: string | null;
};

export type JournalLookupClient = Pick<PrismaClient, "journalDocument" | "journalTemplate">;

const CACHE_CAP = 2000;
const documentCache = new Map<string, { organizationId: string; code: string }>();
const templateCache = new Map<string, string>();

function remember<K, V>(cache: Map<K, V>, key: K, value: V): void {
  if (cache.size >= CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

/** Для тестов и на случай смены шаблона документа. */
export function resetJournalChangeCache(): void {
  documentCache.clear();
  templateCache.clear();
}

export async function resolveJournalChange(
  client: JournalLookupClient,
  hint: JournalWriteHint
): Promise<JournalChange | null> {
  if (hint.organizationId) {
    let code: string | null = null;
    if (hint.templateId) {
      code = templateCache.get(hint.templateId) ?? null;
      if (!code) {
        const template = await client.journalTemplate.findUnique({
          where: { id: hint.templateId },
          select: { code: true },
        });
        if (template) {
          code = template.code;
          remember(templateCache, hint.templateId, code);
        }
      }
    }
    return { organizationId: hint.organizationId, code, documentId: hint.documentId ?? null };
  }

  if (hint.documentId) {
    let info = documentCache.get(hint.documentId);
    if (!info) {
      const document = await client.journalDocument.findUnique({
        where: { id: hint.documentId },
        select: { organizationId: true, template: { select: { code: true } } },
      });
      // Документа уже нет (удалён) или он создан в ещё не закоммиченной
      // транзакции — молчим, опрос догонит.
      if (!document) return null;
      info = { organizationId: document.organizationId, code: document.template.code };
      remember(documentCache, hint.documentId, info);
    }
    return { organizationId: info.organizationId, code: info.code, documentId: hint.documentId };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Очередь: одно событие на организацию за окно
// ---------------------------------------------------------------------------

export const JOURNAL_EVENT_COALESCE_MS = 400;

type Publish = (organizationId: string, event: Omit<LiveEvent, "at">) => number;

type PendingChange = {
  codes: Set<string>;
  documentIds: Set<string>;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, PendingChange>();

/**
 * Поставить изменение в очередь. Первое изменение организации заводит
 * таймер, остальные за окно только дописывают коды и документы; по
 * таймеру уходит один кадр `journal/changed`.
 */
export function queueJournalChange(
  change: JournalChange,
  options: { publish?: Publish; delayMs?: number } = {}
): void {
  const publish = options.publish ?? publishToOrganization;
  const delayMs = options.delayMs ?? JOURNAL_EVENT_COALESCE_MS;
  let slot = pending.get(change.organizationId);
  if (!slot) {
    const created: PendingChange = {
      codes: new Set(),
      documentIds: new Set(),
      timer: setTimeout(() => {
        pending.delete(change.organizationId);
        publish(change.organizationId, {
          type: "journal",
          kind: "changed",
          data: {
            codes: Array.from(created.codes),
            documentIds: Array.from(created.documentIds),
          },
        });
      }, delayMs),
    };
    // Таймер не должен держать процесс (скрипты, тесты).
    created.timer.unref?.();
    pending.set(change.organizationId, created);
    slot = created;
  }
  if (change.code) slot.codes.add(change.code);
  if (change.documentId) slot.documentIds.add(change.documentId);
}

/**
 * Точка входа для хука Prisma: разобрать запись и поставить событие в
 * очередь. Синхронно и без исключений — вызывается после `query(args)`
 * и не должна ни задержать ответ, ни уронить его.
 */
export function notifyJournalWrite(
  client: JournalLookupClient,
  model: JournalModel,
  operation: string,
  args: unknown,
  result: unknown
): void {
  if (!isJournalWriteOperation(operation)) return;
  let hints: JournalWriteHint[];
  try {
    hints = extractJournalWriteHints(model, args, result);
  } catch {
    return;
  }
  if (hints.length === 0) return;
  const isCreate = operation === "create" || operation === "createMany" || operation === "upsert";
  void Promise.all(hints.map((hint) => resolveJournalChange(client, hint)))
    .then((changes) => {
      const seen = new Set<string>();
      for (const change of changes) {
        if (!change) continue;
        queueJournalChange(change);
        // Исходящий вебхук — только на новые записи, по одному на журнал за операцию.
        const key = `${change.organizationId}:${change.code ?? ""}`;
        if (isCreate && !seen.has(key)) {
          seen.add(key);
          const { organizationId, code, documentId } = change;
          emitWebhook(organizationId, "journal.entry", async () => ({
            journalCode: code,
            documentId,
            // Точка документа (2026-11-01) — получатель раскладывает события по точкам.
            ...(await webhookPointFields(organizationId, { documentId })),
          }));
        }
      }
    })
    .catch((error) => console.error("[live] journal change failed", error));
}

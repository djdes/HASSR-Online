/**
 * Shared helpers for TasksFlow adapter rowKey parsing.
 *
 * Three rowKey shapes in production:
 *   - `employee-<userId>`              — per-employee rows (most adapters)
 *   - `employee-<userId>-time-<HH:MM>` — climate adapter (per-time fan-out)
 *   - `freetask:<userId>:<rand>`       — admin-driven free-text task
 *                                        (assembled in bind-row/route.ts)
 *   - `<adapter-specific>`             — e.g. `cleaning-pair-<id>`, managed
 *                                        by the adapter alone
 *
 * Both `employee-` and `freetask:` encode a single responsible WeSetup
 * user id — `extractEmployeeId` returns it so `applyRemoteCompletion`
 * can file the journal entry the same way for either source.
 */
import { journalFillHints } from "@/lib/journal-fill-hints";

/**
 * Adapter-specific suffix `-time-HH:MM` (climate) is stripped here so
 * downstream code never accidentally treats it as part of `<userId>`
 * (which previously caused FK violations on JournalDocumentEntry insert
 * — the trimmed-userId-with-time-suffix didn't match any User row).
 */
const ADAPTER_SUFFIX_RE = /-time-\d{1,2}:\d{2}$/;
/**
 * QR-ввод в строчные журналы (бракераж, скоропорт, охлаждение): адаптеры
 * делают upsert по `sourceRowKey`, а по QR каждая запись — новая строка.
 * Сервер добавляет уникальный хвост `#qr-<время>`; сотрудник из ключа
 * извлекается как обычно. Отправка формы задачи TasksFlow в такой журнал
 * получает такой же хвост `#tf-<время>` (`rowKeyForTaskSubmission`);
 * TasksFlow сам такие ключи не выдаёт.
 */
const QR_APPEND_SUFFIX_RE = /#(?:qr|tf)-\d+$/;

export function rowKeyWithQrAppend(rowKey: string, now: number = Date.now()): string {
  return `${rowKey.replace(QR_APPEND_SUFFIX_RE, "")}#qr-${now}`;
}

/**
 * Ключ строки для одной отправки формы задачи TasksFlow (страница задачи,
 * `POST /api/integrations/tasksflow/complete`). В строчном журнале
 * (`journalFillHints(code).append`: бракераж, скоропорт, охлаждение, приёмка,
 * списание) каждая отправка — новая строка, как по QR: ключ задачи у
 * сотрудника в документе один (`employee-<id>`), и без хвоста вторая отправка
 * переписывала первую строку вместе с подписями комиссии. Остальные журналы
 * получают ключ задачи как есть.
 */
export function rowKeyForTaskSubmission(journalCode: string, rowKey: string, now: number = Date.now()): string {
  if (journalFillHints(journalCode).append !== true) return rowKey;
  return `${rowKey.replace(QR_APPEND_SUFFIX_RE, "")}#tf-${now}`;
}

export function extractEmployeeId(rowKey: string): string | null {
  if (rowKey.startsWith("employee-")) {
    const raw = rowKey.slice("employee-".length).replace(QR_APPEND_SUFFIX_RE, "");
    return raw.replace(ADAPTER_SUFFIX_RE, "");
  }
  if (rowKey.startsWith("freetask:")) {
    const rest = rowKey.slice("freetask:".length);
    const sep = rest.indexOf(":");
    return sep > 0 ? rest.slice(0, sep) : null;
  }
  return null;
}

export function rowKeyForEmployee(userId: string): string {
  return `employee-${userId}`;
}

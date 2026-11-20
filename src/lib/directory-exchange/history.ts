import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import {
  EXCHANGE_SCOPES,
  rowHash,
  type ExchangeEntity,
  type ExchangeFieldValue,
  type ExchangeFields,
  type ExchangeScope,
} from "@/lib/directory-exchange/kinds";
import type { KeepReason } from "@/lib/directory-exchange/transfer-undo";

/**
 * История обмена по организации (серия D, Р5) — чистая часть: снимок записи
 * до и после обмена (`DirectoryExchangeChange.beforeJson` / `afterJson`),
 * подпись «откуда» и отказы отмены. Запись и отмена — `history.server.ts`.
 */

/** Сколько дней видна история и сколько хранятся её строки. */
export const HISTORY_DAYS = 30;
export const HISTORY_MS = HISTORY_DAYS * 86_400_000;

export const CHANGE_OPS = ["create", "update"] as const;
export type ChangeOp = (typeof CHANGE_OPS)[number];

export function isChangeOp(value: unknown): value is ChangeOp {
  return typeof value === "string" && (CHANGE_OPS as readonly string[]).includes(value);
}

/**
 * Запись, как её видел обмен: состав полей (`scope`), свой родитель
 * (должность, объект, цех — id в этой организации) и переносимые поля.
 * `hash` — отпечаток с родителем-«самим собой», как у отмены переноса
 * (`currentHashes` в transfer-undo.server.ts): по нему отмена видит правку
 * после обмена. null — отпечаток не снят.
 */
export type ChangeSnapshot = {
  scope: ExchangeScope;
  parentId: string | null;
  fields: ExchangeFields;
  hash: string | null;
};

/** Снимок строки обмена: поля в составе `scope` и отпечаток с собственным родителем. */
export function changeSnapshot(
  entity: ExchangeEntity,
  row: { fields: ExchangeFields; parentId: string | null },
  scope: ExchangeScope,
): ChangeSnapshot {
  const fields: ExchangeFields = {};
  for (const [key, value] of Object.entries(row.fields)) if (value !== undefined) fields[key] = value;
  return { scope, parentId: row.parentId, fields, hash: rowHash(entity, fields, row.parentId, scope) };
}

function fieldValue(value: unknown): ExchangeFieldValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item))) return value as number[];
  return undefined;
}

/** Снимок из базы; не объект или без полей — null. Мусорные значения полей пропускаются. */
export function parseChangeSnapshot(raw: unknown): ChangeSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as { scope?: unknown; parentId?: unknown; fields?: unknown; hash?: unknown };
  if (!source.fields || typeof source.fields !== "object" || Array.isArray(source.fields)) return null;
  const fields: ExchangeFields = {};
  for (const [key, value] of Object.entries(source.fields as Record<string, unknown>)) {
    const parsed = fieldValue(value);
    if (parsed !== undefined) fields[key] = parsed;
  }
  const scope = EXCHANGE_SCOPES.find((item) => item === source.scope) ?? "account";
  return {
    scope,
    parentId: typeof source.parentId === "string" && source.parentId !== "" ? source.parentId : null,
    fields,
    hash: typeof source.hash === "string" && source.hash !== "" ? source.hash : null,
  };
}

/**
 * Откуда пришла правка — подпись строки истории:
 *   • смотрит организация аккаунта кабинета — название источника; источник
 *     из другой компании помечен (`foreign`);
 *   • смотрит организация другого аккаунта (участник по запросу) — только
 *     «мастер-кабинет «…»»: названий организаций владельца ей не видно.
 * Источника больше нет — тоже подпись кабинета.
 */
export type HistorySource = { name: string; cabinet: boolean; foreign: boolean };

export function historySource(input: {
  viewerAccountId: string | null;
  cabinet: { name: string; accountId: string | null };
  source: { name: string; accountId: string | null } | null;
}): HistorySource {
  const ownSide = Boolean(input.viewerAccountId) && input.viewerAccountId === input.cabinet.accountId;
  if (!ownSide) return { name: input.cabinet.name, cabinet: true, foreign: true };
  if (!input.source) return { name: input.cabinet.name, cabinet: true, foreign: false };
  return { name: input.source.name, cabinet: false, foreign: input.source.accountId !== input.viewerAccountId };
}

export const CHANGE_NOT_FOUND_MESSAGE = "Изменение не найдено";
export const CHANGE_UNDONE_MESSAGE = "Это изменение уже отменено";
export const CHANGE_EXPIRED_MESSAGE = `Изменение можно отменить только в течение ${HISTORY_DAYS} дней`;
export const CHANGE_MISSING_MESSAGE = "Этой записи уже нет в обмене — отменять нечего";
export const CHANGE_NO_BEFORE_MESSAGE = "Прежние значения этой записи не сохранились";
export const CHANGE_CONFLICT_MESSAGE = "Не удалось вернуть прежние значения: такое название уже занято";
export const CHANGE_LIMIT_MESSAGE = "Не удалось вернуть прежние настройки: столько журналов не помещается в тариф";

const KEPT_MESSAGES: Record<KeepReason, string> = {
  edited: "Запись правили после обмена — она осталась как есть",
  used: "Запись уже используется — она осталась как есть",
  not_empty: "Внутри записи остались другие записи — она осталась как есть",
  has_staff: "На должности есть сотрудники — она осталась как есть",
  linked: "Связанное помещение или цех остаётся — запись осталась как есть",
  not_undoable: "Эту правку отменить нельзя",
};

/**
 * Отмена не тронула запись: правили, используется, внутри что-то есть.
 * Ответ — 409 с `reason`, изменение не отмечается отменённым.
 */
export class ExchangeChangeKeptError extends DirectoryExchangeError {
  readonly reason: KeepReason;

  constructor(reason: KeepReason) {
    super(KEPT_MESSAGES[reason], 409, "change_kept");
    this.name = "ExchangeChangeKeptError";
    this.reason = reason;
  }
}

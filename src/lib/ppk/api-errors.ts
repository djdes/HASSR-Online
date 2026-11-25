/**
 * Коды ошибок API ППК, которые интерфейс показывает на языке пользователя
 * (2026-11-25). Сервер отдаёт `{ error, code }`: `error` — русский текст для
 * журналов и старых клиентов, `code` — ключ перевода. Неизвестный код —
 * текст сервера как есть.
 */

/** Доступ к разделу (`requirePpkAccess`) — общий для всех API ППК. */
const ACCESS_ERROR_CODES = ["forbidden", "choose_point"] as const;

/** GET /api/production-control/revisions/compare. */
export const PPK_COMPARE_ERROR_CODES = [
  ...ACCESS_ERROR_CODES,
  "bad_request",
  "doc_not_found",
  "no_revisions",
  "revision_not_found",
  "no_current_text",
] as const;

/** POST /api/production-control/text-docs/draft. */
export const PPK_DRAFT_ERROR_CODES = [
  ...ACCESS_ERROR_CODES,
  "bad_request",
  "rate_limited",
  "ai_not_configured",
  "ai_timeout",
  "ai_failed",
  "ai_empty",
] as const;

/** POST /api/production-control/revisions — утверждение редакции. */
export const PPK_APPROVE_ERROR_CODES = [
  ...ACCESS_ERROR_CODES,
  "bad_request",
  "kb_forbidden",
  "doc_not_found",
  "doc_empty",
  "doc_changed",
] as const;

export type PpkCompareErrorCode = (typeof PPK_COMPARE_ERROR_CODES)[number];

/** `no_current_text` → `noCurrentText`: ключ в каталоге сообщений. */
export type PpkErrorKey<Code extends string> = Code extends `${infer Head}_${infer Tail}`
  ? `${Head}${Capitalize<PpkErrorKey<Tail>>}`
  : Code;

function messageKey<Code extends string>(code: Code): PpkErrorKey<Code> {
  return code.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()) as PpkErrorKey<Code>;
}

/**
 * Текст ошибки для пользователя: известный код — перевод (`translate` получает
 * ключ каталога), иначе текст сервера, иначе запасной текст.
 */
export function ppkErrorText<Code extends string>(
  body: { error?: string; code?: string } | null | undefined,
  known: readonly Code[],
  translate: (key: PpkErrorKey<Code>) => string,
  fallback: string,
): string {
  const code = known.find((item) => item === body?.code);
  if (code) return translate(messageKey(code));
  return body?.error || fallback;
}

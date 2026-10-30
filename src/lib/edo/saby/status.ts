// Коды состояний документа Saby (`Состояние.Код`) и что они значат для строки истории ЭДО.
// Чистый модуль без импортов: его читают и сервер (дубли, обновление статусов), и интерфейс
// (чип статуса). Коды и смыслы — из DocsFlow (`flow-core.ts`, `send-core.ts`), проверены там
// на живом кабинете.

/** Что значит `Состояние.Код` Saby. */
export type SabyStateKind =
  | "draft" | "sent" | "delivered" | "processing" | "waiting_sign"
  | "done" | "rejected" | "error" | "annulled" | "unknown";

const STATE_KINDS: Record<string, SabyStateKind> = {
  "0": "draft",
  "3": "sent",
  "4": "delivered",
  "6": "error",
  "7": "done",
  "9": "rejected",
  "10": "processing",
  "22": "annulled",
  "23": "waiting_sign",
};

/** Код приходит и числом, и строкой; пустой или незнакомый — `unknown`. */
export function sabyStateKind(code: string | number | null | undefined): SabyStateKind {
  if (code === null || code === undefined) return "unknown";
  return STATE_KINDS[String(code).trim()] ?? "unknown";
}

/** Код состояния из ответа Saby → число для БД; не число — null. */
export function sabyStateCodeToInt(code: string): number | null {
  const t = code.trim();
  return /^\d{1,4}$/.test(t) ? Number(t) : null;
}

/**
 * Статус строки истории: `writing` — запись идёт (строка создана, ответа ещё нет); `not_written` —
 * запись упала, документа в Saby нет; `deleted` — был записан, потом удалён в Saby; остальное —
 * по коду Saby.
 */
export type EdoStatusKind = SabyStateKind | "writing" | "not_written" | "deleted";

export type EdoStatusTone = "neutral" | "wait" | "ok" | "bad";

export interface EdoStatusFacts {
  stateCode: number | null;
  deletedAt: Date | string | null;
  error: string | null;
}

export function edoStatusKind(f: EdoStatusFacts): EdoStatusKind {
  if (f.deletedAt) return "deleted";
  if (f.stateCode === null) return f.error ? "not_written" : "writing";
  return sabyStateKind(f.stateCode);
}

/**
 * Вид чипа: `wait` — ждёт человека (черновик ждёт подписи БФС в Saby), `ok` — подписан, `bad` —
 * отклонён / ошибка доставки / не записан.
 */
export function edoStatusTone(kind: EdoStatusKind): EdoStatusTone {
  switch (kind) {
    case "draft":
      return "wait";
    case "done":
      return "ok";
    case "rejected":
    case "error":
    case "not_written":
      return "bad";
    default:
      return "neutral";
  }
}

/** Черновик ждёт отправителя: подписать и отправить его можно только в Saby. */
export function edoWaitsSender(kind: EdoStatusKind): boolean {
  return kind === "draft";
}

/** Документ больше не меняется сам: подписан, отклонён, аннулирован или удалён — перечитывать незачем. */
export function isEdoSettled(f: EdoStatusFacts): boolean {
  const kind = edoStatusKind(f);
  return kind === "deleted" || kind === "done" || kind === "rejected" || kind === "annulled";
}

/**
 * Документ «мёртв» и не мешает новой отправке того же источника: удалён, отклонён, аннулирован,
 * ошибка доставки. Черновик, отправленный, доставленный, подписанный, незнакомый код — живой
 * (не доказано, что документа нет: второй документ с тем же номером хуже отказа).
 */
export function isEdoDead(f: EdoStatusFacts): boolean {
  const kind = edoStatusKind(f);
  return kind === "deleted" || kind === "rejected" || kind === "annulled" || kind === "error";
}

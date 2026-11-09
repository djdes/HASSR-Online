/**
 * Колонки воронки сделок CRM и правила движения. Чистый модуль — его читают и
 * сервер, и канбан.
 */

export const DEAL_STAGES = ["registered", "contract_signed", "message_sent", "called", "won", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_KINDS = ["trial", "renewal"] as const;
export type DealKind = (typeof DEAL_KINDS)[number];

export const DEAL_KIND_LABELS: Record<DealKind, string> = { trial: "Новый клиент", renewal: "Продление" };

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  registered: "Зарегистрировался, договор не подписан",
  contract_signed: "Договор подписан, не оплачено",
  message_sent: "Сообщение отправлено",
  called: "Был прозвон",
  won: "Оплачено",
  lost: "Отказ / бесплатный",
};

/** Короткие подписи — для значков и выпадающего списка. */
export const DEAL_STAGE_SHORT: Record<DealStage, string> = {
  registered: "Зарегистрировался",
  contract_signed: "Договор подписан",
  message_sent: "Сообщение отправлено",
  called: "Был прозвон",
  won: "Оплачено",
  lost: "Отказ",
};

export function isDealStage(value: unknown): value is DealStage {
  return typeof value === "string" && (DEAL_STAGES as readonly string[]).includes(value);
}

export function isDealKind(value: unknown): value is DealKind {
  return typeof value === "string" && (DEAL_KINDS as readonly string[]).includes(value);
}

/** Открытая сделка: ещё не оплачено и не отказ. */
export function isOpenStage(stage: string): boolean {
  return stage !== "won" && stage !== "lost";
}

const ORDER: Record<string, number> = { registered: 0, contract_signed: 1, message_sent: 2, called: 3 };

/**
 * Куда двинуть сделку по событию. Вперёд по рабочим колонкам — только если
 * колонку не ставили руками и событие «дальше» текущей; won/lost — всегда.
 * null — оставить как есть.
 */
export function advanceStage(current: { stage: string; stageManual: boolean }, to: DealStage): DealStage | null {
  if (to === current.stage) return null;
  if (to === "won") return "won";
  if (to === "lost") return current.stage === "won" ? null : "lost";
  if (!isOpenStage(current.stage) || current.stageManual) return null;
  return (ORDER[to] ?? -1) > (ORDER[current.stage] ?? -1) ? to : null;
}

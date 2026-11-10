/**
 * Воронка продаж CRM (2026-11-10): колонки сделки и правила автодвижения.
 * Чистый модуль — сервер (`deals.server.ts`) и доска воронки берут отсюда
 * колонки и решают, куда двигать; правила проверяет `deals.test.ts`.
 */

export const DEAL_STAGES = ["registered", "contract_signed", "message_sent", "called", "won", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  registered: "Зарегистрировался, договор не подписан",
  contract_signed: "Договор подписан, не оплатил",
  message_sent: "Сообщение отправлено",
  called: "Был прозвон",
  won: "Оплачено",
  lost: "Отказ",
};

/** Короткие подписи для карточек и фильтров. */
export const DEAL_STAGE_SHORT: Record<DealStage, string> = {
  registered: "Регистрация",
  contract_signed: "Договор подписан",
  message_sent: "Сообщение",
  called: "Прозвон",
  won: "Оплачено",
  lost: "Отказ",
};

export const DEAL_KIND_LABELS: Record<string, string> = { trial: "Пробный", renewal: "Продление" };

export function isDealStage(value: unknown): value is DealStage {
  return typeof value === "string" && (DEAL_STAGES as readonly string[]).includes(value);
}

export function isClosedStage(stage: string): boolean {
  return stage === "won" || stage === "lost";
}

const ORDER: Record<DealStage, number> = { registered: 0, contract_signed: 1, message_sent: 2, called: 3, won: 4, lost: 4 };

/**
 * Куда сдвинуть сделку автоматикой (null — оставить):
 *  - только вперёд по колонкам;
 *  - колонку поставил человек — дальше только «Оплачено» и «Отказ»;
 *  - «Оплачено» — конец; из «Отказа» вернуть может только оплата.
 */
export function autoAdvance(current: { stage: string; stageManual: boolean }, target: DealStage): DealStage | null {
  const stage = isDealStage(current.stage) ? current.stage : "registered";
  if (stage === target) return null;
  if (stage === "won") return null;
  if (stage === "lost") return target === "won" ? "won" : null;
  if (target === "won" || target === "lost") return target;
  if (current.stageManual) return null;
  return ORDER[target] > ORDER[stage] ? target : null;
}

/** Ключ сделки: одна на пробный и одна на каждый оплаченный срок. */
export function dealKey(kind: "trial" | "renewal", unitKey: string, periodEnd: Date): string {
  return `${kind}:${unitKey}:${periodEnd.toISOString().slice(0, 10)}`;
}

/** Итог задачи → колонка сделки. */
export function stageForOutcome(outcome: string): DealStage | null {
  if (outcome === "reached" || outcome === "promised" || outcome === "callback") return "called";
  if (outcome === "declined") return "lost";
  return null;
}

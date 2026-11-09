/**
 * Состояние контакта CRM из его ленты: когда писал клиент, когда мы, и ждёт
 * ли он нашего ответа. Чистая функция — пересчёт после каждой новой записи.
 */

export type StateInteraction = { direction: string; channel: string; occurredAt: Date };

export type ContactState = {
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  lastActivityAt: Date | null;
  /** Первое входящее после нашего последнего ответа; null — ответа не ждут. */
  awaitingSince: Date | null;
};

/**
 * Ответом считается наше сообщение, отметка «Ответ не нужен» и состоявшийся
 * разговор по телефону — даже входящий: клиенту уже ответили голосом.
 */
export function isAnswer(item: { direction: string; channel: string }): boolean {
  return item.direction === "out" || item.channel === "resolved" || item.channel === "call";
}

export function computeContactState(items: readonly StateInteraction[]): ContactState {
  let lastInboundAt: Date | null = null;
  let lastOutboundAt: Date | null = null;
  let lastAnswerAt: Date | null = null;
  let lastActivityAt: Date | null = null;
  const later = (a: Date | null, b: Date) => (a && a.getTime() >= b.getTime() ? a : b);
  for (const item of items) {
    lastActivityAt = later(lastActivityAt, item.occurredAt);
    if (item.direction === "in") lastInboundAt = later(lastInboundAt, item.occurredAt);
    if (item.direction === "out") lastOutboundAt = later(lastOutboundAt, item.occurredAt);
    if (isAnswer(item)) lastAnswerAt = later(lastAnswerAt, item.occurredAt);
  }
  let awaitingSince: Date | null = null;
  for (const item of items) {
    if (item.direction !== "in") continue;
    if (lastAnswerAt && item.occurredAt.getTime() <= lastAnswerAt.getTime()) continue;
    if (!awaitingSince || item.occurredAt.getTime() < awaitingSince.getTime()) awaitingSince = item.occurredAt;
  }
  return { lastInboundAt, lastOutboundAt, lastActivityAt, awaitingSince };
}

/** Канал, которым пришло неотвеченное входящее (для правил напоминаний). */
export function awaitingChannel(items: readonly StateInteraction[], awaitingSince: Date | null): string | null {
  if (!awaitingSince) return null;
  const item = items.find((entry) => entry.direction === "in" && entry.occurredAt.getTime() === awaitingSince.getTime());
  return item?.channel ?? null;
}

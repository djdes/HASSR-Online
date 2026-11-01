import { db } from "@/lib/db";
import { MAX_ATTEMPTS, nextAttemptAt, signWebhookBody, type WebhookEvent } from "@/lib/webhooks/sign";

/**
 * Очередь доставок (outbox): событие → по одной доставке на каждую
 * включённую подписку организации; крон `webhooks-deliver` раз в минуту
 * отправляет всё, чему пришло время, с повторами 1/5/30 минут.
 */
const TIMEOUT_MS = 10_000;
const BATCH = 50;

/** Данные события; функция — дорогие поля (точка) считаются, только если есть подписки. */
export type WebhookPayload = Record<string, unknown> | (() => Promise<Record<string, unknown>>);

export async function enqueueWebhookEvent(organizationId: string, event: WebhookEvent, payload: WebhookPayload): Promise<number> {
  const hooks = await db.webhook.findMany({ where: { organizationId, enabled: true, events: { has: event } }, select: { id: true } });
  if (hooks.length === 0) return 0;
  const data = typeof payload === "function" ? await payload() : payload;
  const body = { event, organizationId, occurredAt: new Date().toISOString(), data };
  await db.webhookDelivery.createMany({ data: hooks.map((h) => ({ webhookId: h.id, event, payload: body as object, nextAttemptAt: new Date() })) });
  return hooks.length;
}

/** Ничего не роняет: вызывающий код не должен зависеть от вебхуков. */
export function emitWebhook(organizationId: string, event: WebhookEvent, payload: WebhookPayload): void {
  void enqueueWebhookEvent(organizationId, event, payload).catch((error) => console.error("[webhooks] enqueue failed", event, error));
}

export type DeliveryOutcome = { id: string; ok: boolean; status: number | null; error: string | null };

export async function deliverOne(deliveryId: string, now: Date = new Date()): Promise<DeliveryOutcome> {
  const delivery = await db.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { webhook: true } });
  if (!delivery || delivery.status === "sent") return { id: deliveryId, ok: true, status: null, error: null };
  const body = JSON.stringify({ ...(delivery.payload as object), deliveryId: delivery.id, attempt: delivery.attempts + 1 });
  let status: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(delivery.webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "WeSetup-Webhooks/1.0",
        "X-WeSetup-Event": delivery.event,
        "X-WeSetup-Delivery": delivery.id,
        "X-WeSetup-Signature": signWebhookBody(delivery.webhook.secret, body),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 200) : "network error";
  }
  const attempts = delivery.attempts + 1;
  const ok = error === null;
  const retryAt = ok ? null : nextAttemptAt(attempts, now);
  await db.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      attempts,
      lastStatus: status,
      lastError: error,
      status: ok ? "sent" : retryAt && attempts < MAX_ATTEMPTS ? "queued" : "failed",
      nextAttemptAt: ok ? null : retryAt,
      sentAt: ok ? now : null,
    },
  });
  await db.webhook.update({ where: { id: delivery.webhookId }, data: ok ? { lastSuccessAt: now, lastError: null } : { lastError: error } }).catch(() => null);
  return { id: delivery.id, ok, status, error };
}

export async function deliverDue(now: Date = new Date()): Promise<DeliveryOutcome[]> {
  const due = await db.webhookDelivery.findMany({
    where: { status: "queued", nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: BATCH,
    select: { id: true },
  });
  const out: DeliveryOutcome[] = [];
  for (const d of due) out.push(await deliverOne(d.id, now));
  return out;
}

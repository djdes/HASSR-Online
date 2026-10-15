import { NextResponse } from "next/server";

import { serializeWebhook } from "@/lib/webhooks/serialize";
import { recordAuditLog } from "@/lib/audit-log";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { deliverOne } from "@/lib/webhooks/dispatch";
import { generateWebhookSecret, isValidWebhookUrl, isWebhookEvent, type WebhookEvent } from "@/lib/webhooks/sign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(id: string) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) return { session, webhook: null, denied: NextResponse.json({ error: "Доступно руководителям", errorCode: "WEBHOOK_FORBIDDEN" }, { status: 403 }) };
  const webhook = await db.webhook.findFirst({ where: { id, organizationId: getActiveOrgId(session) } });
  if (!webhook) return { session, webhook: null, denied: NextResponse.json({ error: "Подписка не найдена", errorCode: "WEBHOOK_NOT_FOUND" }, { status: 404 }) };
  return { session, webhook, denied: null };
}

/** PATCH { url?, events?, enabled?, rotateSecret? } */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, webhook, denied } = await guard(id);
  if (denied || !webhook) return denied;
  const body = (await request.json().catch(() => ({}))) as { url?: unknown; events?: unknown; enabled?: unknown; rotateSecret?: unknown };
  const data: { url?: string; events?: WebhookEvent[]; enabled?: boolean; secret?: string } = {};
  if (typeof body.url === "string") {
    if (!isValidWebhookUrl(body.url.trim())) return NextResponse.json({ error: "Укажите адрес https://… на внешнем сервере", errorCode: "WEBHOOK_INVALID_URL" }, { status: 400 });
    data.url = body.url.trim();
  }
  if (Array.isArray(body.events)) {
    const events = body.events.filter(isWebhookEvent) as WebhookEvent[];
    if (events.length === 0) return NextResponse.json({ error: "Выберите хотя бы одно событие", errorCode: "WEBHOOK_MISSING_EVENTS" }, { status: 400 });
    data.events = events;
  }
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (body.rotateSecret === true) data.secret = generateWebhookSecret();
  const updated = await db.webhook.update({ where: { id }, data });
  await recordAuditLog({ organizationId: webhook.organizationId, session, request, action: "webhook.update", entity: "Webhook", entityId: id, details: { ...data, secret: data.secret ? "rotated" : undefined } });
  return NextResponse.json({ webhook: serializeWebhook(updated) });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, webhook, denied } = await guard(id);
  if (denied || !webhook) return denied;
  await db.webhook.delete({ where: { id } });
  await recordAuditLog({ organizationId: webhook.organizationId, session, request, action: "webhook.delete", entity: "Webhook", entityId: id, details: { url: webhook.url } });
  return NextResponse.json({ ok: true });
}

/** POST — тестовая доставка `ping` прямо сейчас; ответ адресата возвращается в ответе. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { webhook, denied } = await guard(id);
  if (denied || !webhook) return denied;
  const delivery = await db.webhookDelivery.create({
    data: { webhookId: id, event: "ping", payload: { event: "ping", organizationId: webhook.organizationId, occurredAt: new Date().toISOString(), data: { message: "Тестовое событие из WeSetup" } }, nextAttemptAt: new Date() },
  });
  const outcome = await deliverOne(delivery.id);
  return NextResponse.json({ outcome });
}

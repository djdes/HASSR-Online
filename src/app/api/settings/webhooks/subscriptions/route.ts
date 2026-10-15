import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { serializeWebhook } from "@/lib/webhooks/serialize";
import { generateWebhookSecret, isValidWebhookUrl, isWebhookEvent, type WebhookEvent } from "@/lib/webhooks/sign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOKS = 10;

async function guard() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return { session, orgId: "", denied: NextResponse.json({ error: "Доступно руководителям", errorCode: "WEBHOOK_FORBIDDEN" }, { status: 403 }) };
  }
  return { session, orgId: getActiveOrgId(session), denied: null };
}

/** GET — подписки организации и последние доставки. */
export async function GET() {
  const { orgId, denied } = await guard();
  if (denied) return denied;
  const webhooks = await db.webhook.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } });
  const deliveries = await db.webhookDelivery.findMany({
    where: { webhook: { organizationId: orgId } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, webhookId: true, event: true, status: true, attempts: true, lastStatus: true, lastError: true, createdAt: true, sentAt: true, nextAttemptAt: true },
  });
  return NextResponse.json({
    webhooks: webhooks.map(serializeWebhook),
    deliveries: deliveries.map((d) => ({ ...d, createdAt: d.createdAt.toISOString(), sentAt: d.sentAt?.toISOString() ?? null, nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null })),
  });
}

/** POST { url, events } — новая подписка; секрет генерируется и показывается в настройках. */
export async function POST(request: Request) {
  const { session, orgId, denied } = await guard();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { url?: unknown; events?: unknown };
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!isValidWebhookUrl(url)) return NextResponse.json({ error: "Укажите адрес https://… на внешнем сервере", errorCode: "WEBHOOK_INVALID_URL" }, { status: 400 });
  const events = Array.isArray(body.events) ? body.events.filter(isWebhookEvent) : [];
  if (events.length === 0) return NextResponse.json({ error: "Выберите хотя бы одно событие", errorCode: "WEBHOOK_MISSING_EVENTS" }, { status: 400 });
  const count = await db.webhook.count({ where: { organizationId: orgId } });
  if (count >= MAX_WEBHOOKS) return NextResponse.json({ error: `Не больше ${MAX_WEBHOOKS} подписок`, errorCode: "WEBHOOK_LIMIT", errorParams: { limit: MAX_WEBHOOKS } }, { status: 429 });
  const webhook = await db.webhook.create({
    data: { organizationId: orgId, url, secret: generateWebhookSecret(), events: events as WebhookEvent[], enabled: true, createdById: session.user.id },
  });
  await recordAuditLog({ organizationId: orgId, session, request, action: "webhook.create", entity: "Webhook", entityId: webhook.id, details: { url, events } });
  return NextResponse.json({ webhook: serializeWebhook(webhook) }, { status: 201 });
}

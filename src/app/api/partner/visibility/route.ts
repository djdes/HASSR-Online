import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { db } from "@/lib/db";
import { readJson, requirePartnerApi } from "@/lib/partners/api";
import { invalidatePartnerBranding } from "@/lib/partners/branding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Не показывать клиентам информацию о консультанте» (2026-09-22).
 *
 * GET   → { hideFromClients }
 * PATCH → { hideFromClients: boolean } — только владелец партнёра.
 *
 * Включённый переключатель убирает бренд, контакты и упоминания партнёрства
 * у всех клиентов партнёра: интерфейс, письма, PDF, Telegram, чат поддержки
 * (его ведёт поддержка WeSetup), журнал действий. Доступ к кабинетам
 * клиентов остаётся — клиент видит его как «Службу сопровождения WeSetup».
 */
export async function GET() {
  const auth = await requirePartnerApi();
  if (!auth.ok) return auth.response;
  const partner = await db.partner.findUnique({
    where: { id: auth.ctx.membership.partnerId },
    select: { hideFromClients: true },
  });
  return NextResponse.json({ hideFromClients: partner?.hideFromClients === true });
}

export async function PATCH(request: Request) {
  const auth = await requirePartnerApi();
  if (!auth.ok) return auth.response;
  if (auth.ctx.membership.role !== "owner") {
    return NextResponse.json({ error: "Менять видимость для клиентов может только владелец кабинета партнёра" }, { status: 403 });
  }
  const body = await readJson<{ hideFromClients?: unknown }>(request);
  if (typeof body.hideFromClients !== "boolean") {
    return NextResponse.json({ error: "hideFromClients: true или false" }, { status: 400 });
  }
  const partnerId = auth.ctx.membership.partnerId;
  await db.partner.update({ where: { id: partnerId }, data: { hideFromClients: body.hideFromClients } });
  invalidatePartnerBranding(partnerId);
  await recordAuditLog({
    request,
    session: auth.ctx.session,
    organizationId: auth.ctx.session.user.organizationId,
    action: body.hideFromClients ? "partner.hide_from_clients" : "partner.show_to_clients",
    entity: "partner",
    entityId: partnerId,
    details: { hideFromClients: body.hideFromClients },
  }).catch(() => null);
  return NextResponse.json({ ok: true, hideFromClients: body.hideFromClients });
}

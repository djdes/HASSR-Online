import { NextResponse } from "next/server";
import { requireAuth, getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { recordAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT { enabled: boolean } — автопродление с баланса (`Account.autoRenew`).
 *
 * Включает и выключает руководитель своего кабинета; ROOT «под видом» — нет:
 * это деньги клиента, как и оформление оплаты. Включили, а срок уже на
 * исходе и денег хватает — продлеваем сразу, не дожидаясь утренней задачи.
 */
export async function PUT(request: Request) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю", errorCode: "AUTO_RENEW_FORBIDDEN" }, { status: 403 });
  }
  if (isImpersonating(session)) {
    return NextResponse.json(
      { error: "В режиме «Войти как» автопродление клиента не меняем", errorCode: "AUTO_RENEW_IMPERSONATING" },
      { status: 403 },
    );
  }
  const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled: true | false", errorCode: "AUTO_RENEW_INVALID" }, { status: 400 });
  }
  const enabled = body.enabled;
  const organizationId = getActiveOrgId(session);
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { accountId: true } });
  if (!organization?.accountId) {
    return NextResponse.json({ error: "У организации нет тарифа", errorCode: "AUTO_RENEW_NO_ACCOUNT" }, { status: 409 });
  }

  await db.account.update({
    where: { id: organization.accountId },
    data: { autoRenew: enabled, autoRenewChangedAt: new Date() },
  });
  await recordAuditLog({
    request,
    session,
    organizationId,
    action: enabled ? "billing.auto-renew.enable" : "billing.auto-renew.disable",
    entity: "Account",
    entityId: organization.accountId,
  });

  let renewed = false;
  if (enabled) {
    const { tryAutoRenewForOrganization } = await import("@/lib/balance/auto-renew.server");
    renewed = (await tryAutoRenewForOrganization(organizationId)).status === "renewed";
  }
  return NextResponse.json({ ok: true, enabled, renewed });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { clientIp } from "@/lib/client-ip";
import { serviceRequestRateLimiter } from "@/lib/rate-limit";
import { recordAuditLog } from "@/lib/audit-log";
import { checkPlanFeature, limitResponse } from "@/lib/billing.server";
import { hardwareTotal, normalizeHardwareConfig } from "@/lib/hardware-pricing";
import { createServiceRequest } from "@/lib/services/requests";
import { equipmentDeliveryComment, equipmentDeliveryService } from "@/lib/services/equipment-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/equipment/delivery-request — заказать доставку уже
 * подключённого к аккаунту оборудования (тариф «Премиум» и пробный период).
 *
 * Тело: `{ config: { deviceId: qty }, contactName, contactPhone, address?, comment? }`.
 * Состав нормализуется и считается по прайсу на сервере; деньги здесь не
 * списываются — менеджер согласует доставку и монтаж. Заявка попадает в
 * ROOT → «Заявки на услуги», владельцу уходит уведомление.
 */

const Schema = z.object({
  config: z.record(z.string(), z.unknown()),
  contactName: z.string().trim().min(2, "Укажите имя").max(120),
  contactPhone: z.string().trim().min(6, "Укажите телефон").max(32),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
});

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Заказать оборудование может руководитель" }, { status: 403 });
  }
  const ip = clientIp(request) ?? "unknown";
  if (!serviceRequestRateLimiter.consume(`equipment-delivery:${ip}`)) {
    return NextResponse.json({ error: "Слишком много заявок. Попробуйте позже" }, { status: 429 });
  }

  const organizationId = getActiveOrgId(session);
  const feature = await checkPlanFeature(organizationId, "equipmentDelivery", "equipment/delivery-request");
  if (!feature.ok) return limitResponse(feature);

  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  }
  const config = normalizeHardwareConfig(parsed.data.config);
  if (Object.keys(config).length === 0) {
    return NextResponse.json({ error: "Выберите оборудование" }, { status: 400 });
  }

  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  try {
    const result = await createServiceRequest({
      service: equipmentDeliveryService(config),
      organizationId,
      organizationName: org?.name ?? null,
      userId: session.user.id,
      contactName: parsed.data.contactName,
      contactPhone: parsed.data.contactPhone,
      contactEmail: session.user.email ?? null,
      comment: equipmentDeliveryComment({
        config,
        address: parsed.data.address || null,
        comment: parsed.data.comment || null,
      }),
      source: "app",
      payFromBalance: false,
      canSpend: false,
    });
    await recordAuditLog({
      request,
      session,
      organizationId,
      action: "equipment.delivery-request",
      entity: "ServiceRequest",
      entityId: result.id,
      details: { config, totalRub: hardwareTotal(config) },
    });
    console.info("[equipment] delivery requested", { organizationId, requestId: result.id, totalRub: hardwareTotal(config) });
    return NextResponse.json({ ok: true, id: result.id });
  } catch (error) {
    console.error("[equipment] delivery request failed", error);
    return NextResponse.json({ error: "Не удалось отправить заявку. Попробуйте ещё раз" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  describePromoCodeChange,
  findOrganizationName,
  PROMO_CODE_AUDIT_ENTITY,
  promoCodePatchSchema,
  toPromoCodeAdminRow,
} from "@/lib/promo/promo-codes-admin";
import { PLATFORM_ORG_ID } from "@/lib/promo/promotions-admin";
import { promoPaidUses } from "@/lib/promo/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH — включить/выключить, поправить срок, лимит, заметку, «навсегда»,
 * персональные почту/организацию, метку рассылки. Код и размер скидки не
 * меняются: на них уже могли сослаться. Уже привязанные скидки навсегда
 * правка кода не меняет (снимок в AccountLifetimeDiscount).
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  const parsed = promoCodePatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  }
  const before = await db.promoCode.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Промокод не найден" }, { status: 404 });
  const data = parsed.data;
  const organizationId = data.organizationId !== undefined ? data.organizationId : before.organizationId;
  const organizationName = await findOrganizationName(organizationId);
  if (data.organizationId && !organizationName) {
    return NextResponse.json({ error: "Организация с таким id не найдена" }, { status: 400 });
  }
  const row = await db.promoCode.update({
    where: { id },
    data: {
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.endsAt !== undefined ? { endsAt: data.endsAt ? new Date(data.endsAt) : null } : {}),
      ...(data.maxUses !== undefined ? { maxUses: data.maxUses } : {}),
      ...(data.newClientsOnly !== undefined ? { newClientsOnly: data.newClientsOnly } : {}),
      ...(data.note !== undefined ? { note: data.note || null } : {}),
      ...(data.lifetime !== undefined ? { lifetime: data.lifetime } : {}),
      ...(data.personalEmail !== undefined ? { personalEmail: data.personalEmail } : {}),
      ...(data.organizationId !== undefined ? { organizationId: data.organizationId } : {}),
      ...(data.campaignId !== undefined ? { campaignId: data.campaignId } : {}),
    },
  });
  const summary = describePromoCodeChange(before, row);
  const action =
    before.active !== row.active && summary === (row.active ? "включён" : "выключен")
      ? row.active
        ? "promo.enable"
        : "promo.disable"
      : "promo.update";
  console.info(`[promo] root ${action} ${row.code}: ${summary} by ${session.user.email ?? session.user.id}`);
  await recordAuditLog({
    request,
    session,
    organizationId: PLATFORM_ORG_ID,
    action,
    entity: PROMO_CODE_AUDIT_ENTITY,
    entityId: row.id,
    details: { code: row.code, summary },
  });
  const uses = await promoPaidUses([row.code]);
  return NextResponse.json({
    code: toPromoCodeAdminRow(row, { paidUses: uses[row.code] ?? 0, organizationName }),
  });
}

import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  describePromotion,
  describePromotionChange,
  mskInputToDate,
  validatePromotionInput,
} from "@/lib/promo/promotions";
import {
  PLATFORM_ORG_ID,
  PROMOTION_AUDIT_ENTITY,
  promotionPatchSchema,
  toPromotionAdminRow,
} from "@/lib/promo/promotions-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH — изменить любые поля акции (включить/выключить — `active`);
 * DELETE — удалить. Заказы, оплаченные по акции, хранят её процент и
 * скидку снимком, поэтому удаление отчёты не ломает.
 */

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  const parsed = promotionPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  }
  const before = await db.pricePromotion.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Акция не найдена" }, { status: 404 });

  const startsAt = parsed.data.startsAt !== undefined ? mskInputToDate(parsed.data.startsAt) : before.startsAt;
  const endsAt = parsed.data.endsAt !== undefined ? mskInputToDate(parsed.data.endsAt) : before.endsAt;
  if (!startsAt || !endsAt) {
    return NextResponse.json({ error: "Укажите начало и конец акции" }, { status: 400 });
  }
  const verdict = validatePromotionInput({
    title: parsed.data.title ?? before.title,
    percent: parsed.data.percent ?? before.percent,
    startsAt,
    endsAt,
    note: parsed.data.note !== undefined ? parsed.data.note : before.note,
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 400 });

  const row = await db.pricePromotion.update({
    where: { id },
    data: {
      title: verdict.value.title,
      percent: verdict.value.percent,
      startsAt: verdict.value.startsAt,
      endsAt: verdict.value.endsAt,
      note: verdict.value.note,
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    },
  });
  const summary = describePromotionChange(before, row);
  const action =
    before.active !== row.active && summary === (row.active ? "включена" : "выключена")
      ? row.active
        ? "promotion.enable"
        : "promotion.disable"
      : "promotion.update";
  console.info(`[promo] ${action} ${row.id} «${row.title}»: ${summary} by ${session.user.email ?? session.user.id}`);
  await recordAuditLog({
    request,
    session,
    organizationId: PLATFORM_ORG_ID,
    action,
    entity: PROMOTION_AUDIT_ENTITY,
    entityId: row.id,
    details: {
      title: row.title,
      summary,
      before: {
        title: before.title,
        percent: before.percent,
        startsAt: before.startsAt.toISOString(),
        endsAt: before.endsAt.toISOString(),
        active: before.active,
      },
      after: {
        title: row.title,
        percent: row.percent,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        active: row.active,
      },
    },
  });
  return NextResponse.json({ promotion: toPromotionAdminRow(row) });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  const row = await db.pricePromotion.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Акция не найдена" }, { status: 404 });
  await db.pricePromotion.delete({ where: { id } });
  const summary = describePromotion(row);
  console.info(`[promo] promotion deleted ${row.id} «${row.title}» ${summary} by ${session.user.email ?? session.user.id}`);
  await recordAuditLog({
    request,
    session,
    organizationId: PLATFORM_ORG_ID,
    action: "promotion.delete",
    entity: PROMOTION_AUDIT_ENTITY,
    entityId: row.id,
    details: {
      title: row.title,
      summary,
      percent: row.percent,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      active: row.active,
    },
  });
  return NextResponse.json({ ok: true });
}

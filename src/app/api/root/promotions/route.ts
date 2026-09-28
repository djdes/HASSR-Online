import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { describePromotion, mskInputToDate, validatePromotionInput } from "@/lib/promo/promotions";
import {
  PLATFORM_ORG_ID,
  PROMOTION_AUDIT_ENTITY,
  listPromotionsForRoot,
  promotionCreateSchema,
  toPromotionAdminRow,
} from "@/lib/promo/promotions-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/root/promotions — акции на подписку (ROOT-only; остальным
 * middleware и requireRoot отдают 404). GET — список, POST — создать.
 * Каждое изменение — строка в AuditLog (организация platform) и
 * `[promo]` в логе сервера.
 */

export async function GET() {
  await requireRoot();
  return NextResponse.json({ promotions: await listPromotionsForRoot() });
}

export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = promotionCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  }
  const startsAt = mskInputToDate(parsed.data.startsAt);
  const endsAt = mskInputToDate(parsed.data.endsAt);
  if (!startsAt || !endsAt) {
    return NextResponse.json({ error: "Укажите начало и конец акции" }, { status: 400 });
  }
  const verdict = validatePromotionInput({
    title: parsed.data.title,
    percent: parsed.data.percent,
    startsAt,
    endsAt,
    note: parsed.data.note ?? null,
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 400 });

  const row = await db.pricePromotion.create({
    data: {
      title: verdict.value.title,
      percent: verdict.value.percent,
      startsAt: verdict.value.startsAt,
      endsAt: verdict.value.endsAt,
      active: parsed.data.active ?? true,
      note: verdict.value.note,
    },
  });
  const summary = `${describePromotion(row)}${row.active ? "" : " · выключена"}`;
  console.info(
    `[promo] promotion created ${row.id} «${row.title}» ${summary} by ${session.user.email ?? session.user.id}`
  );
  await recordAuditLog({
    request,
    session,
    organizationId: PLATFORM_ORG_ID,
    action: "promotion.create",
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
  return NextResponse.json({ promotion: toPromotionAdminRow(row) });
}

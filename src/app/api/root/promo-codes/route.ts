import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  describePromoCode,
  findOrganizationName,
  listPromoCodesForRoot,
  PROMO_CODE_AUDIT_ENTITY,
  promoCodeCreateSchema,
  toPromoCodeAdminRow,
} from "@/lib/promo/promo-codes-admin";
import { PLATFORM_ORG_ID } from "@/lib/promo/promotions-admin";
import { isValidPromoCodeFormat, normalizePromoCode } from "@/lib/promo/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/root/promo-codes — промокоды (ROOT-only). GET — список, POST —
 * создать (в том числе «навсегда» и персональный: почта и/или
 * организация). Каждое создание — `[promo]` в логе и строка AuditLog.
 */

export async function GET() {
  await requireRoot();
  return NextResponse.json({ codes: await listPromoCodesForRoot() });
}

export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = promoCodeCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  }
  const code = normalizePromoCode(parsed.data.code);
  if (!isValidPromoCodeFormat(code)) {
    return NextResponse.json({ error: "Код: латиница, цифры, «-» и «_», от 3 до 32 символов" }, { status: 400 });
  }
  if (parsed.data.kind === "percent" && parsed.data.value > 100) {
    return NextResponse.json({ error: "Процент не может быть больше 100" }, { status: 400 });
  }
  const organizationId = parsed.data.organizationId ?? null;
  const organizationName = await findOrganizationName(organizationId);
  if (organizationId && !organizationName) {
    return NextResponse.json({ error: "Организация с таким id не найдена" }, { status: 400 });
  }
  const exists = await db.promoCode.findUnique({ where: { code } });
  if (exists) return NextResponse.json({ error: "Такой код уже есть" }, { status: 409 });
  const row = await db.promoCode.create({
    data: {
      code,
      kind: parsed.data.kind,
      value: parsed.data.value,
      startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
      endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
      maxUses: parsed.data.maxUses ?? null,
      newClientsOnly: parsed.data.newClientsOnly ?? false,
      note: parsed.data.note || null,
      lifetime: parsed.data.lifetime ?? false,
      personalEmail: parsed.data.personalEmail ?? null,
      organizationId,
      campaignId: parsed.data.campaignId ?? null,
    },
  });
  const summary = describePromoCode(row);
  console.info(`[promo] root created code ${row.code} (${summary}) by ${session.user.email ?? session.user.id}`);
  await recordAuditLog({
    request,
    session,
    organizationId: PLATFORM_ORG_ID,
    action: "promo.create",
    entity: PROMO_CODE_AUDIT_ENTITY,
    entityId: row.id,
    details: { code: row.code, summary },
  });
  return NextResponse.json({ code: toPromoCodeAdminRow(row, { paidUses: 0, organizationName }) });
}

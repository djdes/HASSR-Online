import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { createPersonalPromoCodes } from "@/lib/promo/personal-codes";
import { describePromoCode, PROMO_CODE_AUDIT_ENTITY } from "@/lib/promo/promo-codes-admin";
import { PROMO_VALID_DAYS_MAX, PROMO_VALID_DAYS_MIN, promoEndsAfterDays } from "@/lib/promo/valid-days";
import { PLATFORM_ORG_ID, proposalPromoOption } from "@/lib/proposal/root.server";
import { isProposalSphere } from "@/lib/proposal/spheres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  companyName: z.string().trim().min(1, "Укажите компанию — код будет с её названием").max(120, "Компания — до 120 знаков"),
  sphere: z
    .string()
    .refine((value) => isProposalSphere(value), "Неизвестная сфера")
    .nullable()
    .optional(),
  value: z.number().int("Скидка — целое число процентов").min(1, "Скидка — от 1 до 100 %").max(100, "Скидка — от 1 до 100 %"),
  validDays: z
    .number()
    .int("Срок — целое число дней")
    .min(PROMO_VALID_DAYS_MIN, `Срок — от ${PROMO_VALID_DAYS_MIN} до ${PROMO_VALID_DAYS_MAX} дней`)
    .max(PROMO_VALID_DAYS_MAX, `Срок — от ${PROMO_VALID_DAYS_MIN} до ${PROMO_VALID_DAYS_MAX} дней`),
});

/**
 * POST /api/root/proposals/personal-code — «Создать персональный код для
 * этой компании» в генераторе КП: одноразовый код без привязки к почте и
 * организации (`unlocked` — КП пересылают тому, кто платит), скидка в
 * процентах навсегда, срок — N дней (до 23:59 МСК). Основа кода — название
 * компании («ROMASHKA10»), заметка «Генератор КП · <компания>».
 * Аудит — `promo.create`, как у ROOT → «Промокоды».
 */
export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  }
  const { companyName, value, validDays } = parsed.data;
  const sphere = parsed.data.sphere ?? null;
  const endsAt = promoEndsAfterDays(new Date(), validDays);
  const by = session.user.email ?? session.user.id;
  try {
    const created = await createPersonalPromoCodes(
      [{ key: "kp-generator", email: null, companyName, unlocked: true }],
      { kind: "percent", value, lifetime: true, endsAt, note: "Генератор КП" }
    );
    const ref = created.get("kp-generator");
    if (!ref) throw new Error("код не создан");
    const row = await db.promoCode.findUniqueOrThrow({ where: { id: ref.id } });
    const summary = describePromoCode(row);
    console.info(
      `[kp] root created personal code ${row.code} (${summary}) company=«${companyName}» sphere=${sphere ?? "-"} ends=${endsAt.toISOString()} by=${by}`
    );
    await recordAuditLog({
      request,
      session,
      organizationId: PLATFORM_ORG_ID,
      action: "promo.create",
      entity: PROMO_CODE_AUDIT_ENTITY,
      entityId: row.id,
      details: { code: row.code, summary, source: "kp-generator", companyName, sphere, validDays, endsAt: endsAt.toISOString() },
    });
    return NextResponse.json({ option: proposalPromoOption(row) });
  } catch (error) {
    console.error(`[kp] root personal code failed company=«${companyName}» by=${by}`, error);
    return NextResponse.json({ error: "Не удалось создать код — попробуйте ещё раз" }, { status: 500 });
  }
}

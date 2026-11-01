import { NextResponse, after } from "next/server";

import { authOptions } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { guestBuyerFrom, guestInvoicePdfPath, parseGuestInvoiceInput } from "@/lib/invoices/guest";
import { createGuestInvoiceOrder, deliverGuestInvoice } from "@/lib/invoices/service";
import { refuseMobileAppPayment } from "@/lib/mobile-app-payments";
import { buildLegalProfile, fetchDadataParty } from "@/lib/org-legal-profile";
import { parseCheckoutTarget } from "@/lib/plan-checkout.server";
import { guestInvoiceRateLimiter } from "@/lib/rate-limit";
import { getServerSession } from "@/lib/server-session";
import { encodePartnerRef, readPartnerRefFromRequest } from "@/lib/partners/referral";
import { REFERRAL_COOKIE, readCookie } from "@/lib/balance/constants";
import { resolveReferrerByCode } from "@/lib/balance/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/payments/invoice/guest { inn, email, companyName?, plan, cycle,
 * points, promoCode?, expectedGrossRub? } — счёт по ИНН без регистрации
 * (/order, 2026-11-01). Покупатель — ЕГРЮЛ по ИНН (DaData) или введённое
 * название. Сумма — как у оплаты картой. Вошедшему — отказ: его счёт
 * выставляется в «Настройки → Тариф» на его организацию. PDF — письмом и по
 * подписанной ссылке; заметка админу — после ответа.
 */
export async function POST(request: Request) {
  const appRefusal = refuseMobileAppPayment(request);
  if (appRefusal) return appRefusal;
  const session = await getServerSession(authOptions).catch(() => null);
  if (session?.user) {
    return NextResponse.json(
      { error: "Вы вошли в кабинет — счёт на вашу организацию выставляется в «Настройки → Тариф»", code: "signed-in" },
      { status: 409 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseGuestInvoiceInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const target = parseCheckoutTarget({ plan: body.plan, cycle: body.cycle, points: body.points });
  if (!target) return NextResponse.json({ error: "Тариф недоступен" }, { status: 400 });

  const ip = clientIp(request) ?? "unknown";
  if (!guestInvoiceRateLimiter.consume(`guest-invoice:${ip}`)) {
    return NextResponse.json({ error: "Слишком много счетов подряд. Подождите несколько минут или позвоните нам" }, { status: 429 });
  }

  // ЕГРЮЛ: нашли — реквизиты из него; нет ключа или не нашли — нужно название.
  const party = await fetchDadataParty(parsed.value.inn).catch(() => null);
  const buyer = guestBuyerFrom(parsed.value, party ? buildLegalProfile(party) : null);
  if (!buyer) {
    return NextResponse.json(
      { error: "Не нашли организацию по ИНН — впишите её название, как в документах", code: "name-required" },
      { status: 400 },
    );
  }

  const promoCode = typeof body.promoCode === "string" && body.promoCode.trim() ? body.promoCode.slice(0, 64) : null;
  // Метки партнёра и клиента-рекомендателя — как у оплаты картой: после
  // оплаты новая организация привяжется к ним.
  const partnerRef = readPartnerRefFromRequest(request);
  const referrer = await resolveReferrerByCode(readCookie(request, REFERRAL_COOKIE)).catch(() => null);
  const result = await createGuestInvoiceOrder({
    email: parsed.value.email,
    buyer,
    target,
    promoCode,
    expectedGrossRub: typeof body.expectedGrossRub === "number" ? body.expectedGrossRub : null,
    partnerSlug: partnerRef ? encodePartnerRef(partnerRef) : null,
    referrerOrganizationId: referrer?.id ?? null,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.grossRub !== undefined ? { grossRub: result.grossRub } : {}) },
      { status: result.status },
    );
  }
  if (result.created) {
    after(() => deliverGuestInvoice(result.order.id).catch((error) => console.error("[invoices] guest deliver failed", error)));
  }
  return NextResponse.json({
    orderId: result.order.id,
    amountRub: Number(result.order.amountRub),
    dueAt: result.order.invoiceDueAt,
    created: result.created,
    buyerName: buyer.name,
    pdfUrl: guestInvoicePdfPath(result.order.id, result.order.email),
  });
}

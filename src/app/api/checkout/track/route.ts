import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { recordCheckoutVisit } from "@/lib/crm/checkout.server";
import { normalizeEmail } from "@/lib/crm/identity";
import { refuseMobileAppPayment } from "@/lib/mobile-app-payments";
import { parseCheckoutTarget, quoteCheckout } from "@/lib/plan-checkout.server";
import { planTariffKey } from "@/lib/tariff-plans";
import { checkoutTrackRateLimiter } from "@/lib/rate-limit";
import { verifyGuestOrderChallenge } from "@/lib/registration-antibot";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/track { email, plan, cycle, points, captchaToken, website } —
 * гость на /order ввёл почту: запись «открыл оформление» в CRM (спека
 * checkout-conversion-2026-11-22). Через 30 минут без оплаты прогон CRM
 * поставит задачу и напишет админам. Вошедшего записывает сама страница —
 * здесь ему нечего делать. Ответ всегда `{ ok }`: адрес не подсказывает,
 * какие почты уже есть в CRM.
 */
export async function POST(request: Request) {
  const appRefusal = refuseMobileAppPayment(request);
  if (appRefusal) return appRefusal;
  const session = await getServerSession(authOptions).catch(() => null);
  if (session?.user) return NextResponse.json({ ok: true });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = normalizeEmail(typeof body.email === "string" ? body.email : null);
  const target = parseCheckoutTarget({ plan: body.plan, cycle: body.cycle, points: body.points });
  if (!email || !target) return NextResponse.json({ ok: false, error: "Нужны почта и тариф" }, { status: 400 });
  // Запись заводит контакт CRM и сообщение админам — без проверки от ботов это спам-канал.
  const challenge = await verifyGuestOrderChallenge(body);
  if (challenge) return NextResponse.json({ ok: false, error: challenge.error }, { status: challenge.status });
  const ip = clientIp(request) ?? "unknown";
  if (!checkoutTrackRateLimiter.consume(`checkout-track:${ip}`)) {
    return NextResponse.json({ ok: false, error: "Слишком часто" }, { status: 429 });
  }

  const now = new Date();
  const quote = await quoteCheckout({ organizationId: null, target, now }).catch(() => null);
  await recordCheckoutVisit({
    email,
    tariffKey: quote?.ok ? quote.offer.tariffKey : planTariffKey(target.tier, target.cycle),
    points: target.points,
    amountRub: quote?.ok ? quote.offer.priceRub : 0,
    at: now,
    source: "guest",
  });
  return NextResponse.json({ ok: true });
}

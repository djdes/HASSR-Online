import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { PLANS, isValidPlanId } from "@/lib/plans";
import { isManagerRole } from "@/lib/user-roles";
import { refuseMobileAppPayment } from "@/lib/mobile-app-payments";

const YOOKASSA_API = "https://api.yookassa.ru/v3";

export async function POST(request: Request) {
  const appRefusal = refuseMobileAppPayment(request);
  if (appRefusal) return appRefusal;
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Только manager (или ROOT impersonating). head_chef не должен
    // создавать платежи — это финансовое решение собственника.
    // Раньше missing isRoot bypass — ROOT impersonating клиента
    // получал 403 при попытке создать платёж от имени клиента
    // (типичный сценарий support — провести платёж за клиента).
    if (!isManagerRole(session.user.role) && !session.user.isRoot) {
      return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const plan = (body as { plan?: unknown }).plan;
    if (!isValidPlanId(plan)) {
      return NextResponse.json({ error: "Неизвестный тариф" }, { status: 400 });
    }
    const planInfo = PLANS[plan];

    const shopId = process.env.YOOKASSA_SHOP_ID;
    const secretKey = process.env.YOOKASSA_SECRET_KEY;

    if (!shopId || !secretKey) {
      return NextResponse.json(
        { error: "Платёжная система не настроена" },
        { status: 500 }
      );
    }

    // Bucket в 5-минутные окна. Раньше: ${Date.now()} делал
    // КАЖДЫЙ запрос уникальным — если юзер дважды нажал «Оплатить»,
    // создавалось два независимых платежа в YooKassa (он списывал
    // дважды, мы возвращали два разных confirmation URL'а). Теперь
    // двойной клик в окне 5 мин → тот же idempotence key → YooKassa
    // возвращает тот же payment.
    const fiveMinBucket = Math.floor(Date.now() / (5 * 60 * 1000));
    const idempotenceKey = `${getActiveOrgId(session)}-${plan}-${fiveMinBucket}`;

    // YooKassa requires a 15s-or-less response; abort if it takes longer.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let response: Response;
    try {
      response = await fetch(`${YOOKASSA_API}/payments`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Idempotence-Key": idempotenceKey,
          Authorization: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`,
        },
        body: JSON.stringify({
          amount: {
            value: planInfo.priceRub.toFixed(2),
            currency: "RUB",
          },
          capture: true,
          confirmation: {
            type: "redirect",
            return_url: `${process.env.NEXTAUTH_URL}/settings/subscription?status=success`,
          },
          description: `WeSetup: тариф "${planInfo.name}" (${planInfo.durationDays} дн)`,
          metadata: {
            organizationId: getActiveOrgId(session),
            plan,
          },
          save_payment_method: true,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const err = await response.text();
      console.error("YooKassa error:", err);
      return NextResponse.json({ error: "Ошибка создания платежа" }, { status: 502 });
    }

    const payment = (await response.json()) as {
      id: string;
      confirmation: { confirmation_url: string };
    };

    // Store payment ID so the webhook can verify it actually originated from our
    // server. Field is historically named yookassaShopId but stores the pending
    // payment identifier.
    await db.organization.update({
      where: { id: getActiveOrgId(session) },
      data: { yookassaShopId: payment.id },
    });

    return NextResponse.json({
      confirmationUrl: payment.confirmation.confirmation_url,
      paymentId: payment.id,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Платёжная система не отвечает" },
        { status: 504 }
      );
    }
    console.error("Payment create error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { resolvePromo } from "@/lib/promo/service";
import { readTariff, TARIFF_BUNDLE } from "@/lib/tariffs";
import {
  hardwareTotal,
  normalizeHardwareConfig,
} from "@/lib/hardware-pricing";
import {
  buildPaymentParams,
  buildPaymentUrl,
  isConfigured,
  isTestMode,
  sendReceipt,
  type ReceiptItem,
} from "@/lib/robokassa";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  OFFER_REVISION,
  RECURRING_CONSENT_TEXT,
} from "@/lib/recurring-consent";
import { encodePartnerRef, readPartnerRefFromRequest } from "@/lib/partners/referral";
import { REFERRAL_COOKIE, readCookie } from "@/lib/balance/constants";
import { createOrderWithPoints } from "@/lib/balance/checkout";
import { resolveReferrerByCode } from "@/lib/balance/referral";
import { completePaidOrder } from "@/lib/payment-fulfillment";
import { refuseMobileAppPayment } from "@/lib/mobile-app-payments";

export const dynamic = "force-dynamic";

/**
 * Создание заказа на оплату. Endpoint публичный — вызывается со страницы
 * /order и до какой-либо авторизации (клиента ещё нет, он появится после
 * оплаты), но у вошедшего пользователя работает и списание баллов.
 *
 * Сумма считается ТОЛЬКО на сервере: с клиента приходит состав корзины
 * (`{ deviceId: qty }`) и тумблер «списать баллы», а рубли берутся из
 * БД-тарифа, прайса железа и баланса организации. Иначе можно было бы
 * прислать «оплачу за 1 ₽».
 */

const createOrderRateLimiter = createRateLimiter({
  // 10 заказов за 10 минут на IP: живому человеку хватит на несколько
  // попыток и смену тарифа, скрипту — нет.
  tokensPerInterval: 10,
  intervalMs: 10 * 60 * 1000,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Робокасса не должна держать ссылку дольше холда баллов. */
const EXPIRATION_HOURS = 23;

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * `ExpirationDate` Робокассы: «YYYY-MM-DDTHH:mm:ss.0000000+03:00».
 * В подпись не входит — добавляется после SignatureValue, как Recurring.
 */
function expirationDate(from: Date): string {
  const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
  const msk = new Date(from.getTime() + EXPIRATION_HOURS * 3600_000 + MSK_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${msk.getUTCFullYear()}-${pad(msk.getUTCMonth() + 1)}-${pad(msk.getUTCDate())}` +
    `T${pad(msk.getUTCHours())}:${pad(msk.getUTCMinutes())}:${pad(msk.getUTCSeconds())}` +
    ".0000000+03:00"
  );
}

export async function POST(request: NextRequest) {
  const appRefusal = refuseMobileAppPayment(request);
  if (appRefusal) return appRefusal;
  if (!createOrderRateLimiter.consume(clientIp(request))) {
    return NextResponse.json(
      { error: "Слишком много попыток. Попробуйте через несколько минут" },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const session = await getServerSession(authOptions).catch(() => null);
  // Почта вошедшего берётся из сессии принудительно. Иначе баллы
  // организации ушли бы на заказ с чужим адресом, а вебхук по этому
  // адресу завёл бы ещё одну организацию.
  const email = session?.user?.email
    ? session.user.email.trim().toLowerCase()
    : typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";
  const tariffKey = typeof body.tariffKey === "string" ? body.tariffKey : "";

  if (!EMAIL_RE.test(email) || email.length > 200) {
    return NextResponse.json(
      { error: "Укажите корректный адрес электронной почты" },
      { status: 400 },
    );
  }

  const tariff = await readTariff(tariffKey);
  if (!tariff) {
    return NextResponse.json({ error: "Тариф недоступен" }, { status: 400 });
  }

  const bundleConfig =
    tariff.key === TARIFF_BUNDLE
      ? normalizeHardwareConfig(body.bundleConfig)
      : null;
  const grossRub =
    tariff.priceRub + (bundleConfig ? hardwareTotal(bundleConfig) : 0);

  // Проверка по ПОЛНОЙ сумме: заказ, полностью закрытый баллами, —
  // нормальный сценарий, а вот пустая корзина без подписки — нет.
  if (grossRub <= 0) {
    return NextResponse.json(
      { error: "Сумма заказа получилась нулевой — выберите оборудование" },
      { status: 400 },
    );
  }

  const description = bundleConfig
    ? `${tariff.title} (подписка на ${tariff.periodDays} дн. + оборудование)`
    : `${tariff.title} на ${tariff.periodDays} дн.`;

  // Галочка автосписаний. Не проставлена — платёж разовый: нажатие
  // «Оплатить» без галочки обязано просто провести оплату, а не требовать
  // согласия. Значение приводим строго к boolean.
  const recurringConsent = body.recurringConsent === true;

  // Баллы и автосписания несовместимы: касса запомнила бы карту с
  // уменьшенным OutSum, и будущие списания шли бы не по цене тарифа.
  const organizationId =
    session?.user && hasFullWorkspaceAccess(session.user) && !isImpersonating(session)
      ? getActiveOrgId(session)
      : null;
  const usePoints =
    body.usePoints !== false && !recurringConsent && Boolean(organizationId);
  // Промокод: скидка от цены подписки, считается здесь, не в браузере.
  // Неподходящий код — ошибка, а не молчаливая оплата без скидки.
  const promoRaw = typeof body.promoCode === "string" ? body.promoCode : "";
  let promoCode: string | null = null;
  let discountRub = 0;
  if (promoRaw.trim()) {
    const promo = await resolvePromo(promoRaw, {
      organizationId,
      subscriptionRub: tariff.priceRub,
    });
    if (!promo.ok) return NextResponse.json({ error: promo.message }, { status: 400 });
    promoCode = promo.code;
    discountRub = promo.discountRub;
  }
  // Описание заказа с промокодом — оно же в чеке, УПД и ответе клиенту.
  const orderDescription = promoCode
    ? `${description} (промокод ${promoCode}: −${discountRub} ₽)`
    : description;

  // Метка партнёра (cookie с /p/<slug>) едет в заказ: после оплаты
  // организация нового клиента привяжется к партнёру.
  const partnerRef = readPartnerRefFromRequest(request);
  // Реферальная метка клиента (cookie с /r/<code>) — для оплаты без
  // предварительной регистрации: организацию создаст вебхук.
  const referrer = await resolveReferrerByCode(
    readCookie(request, REFERRAL_COOKIE),
  );

  const order = await createOrderWithPoints({
    organizationId,
    userId: session?.user?.id ?? null,
    email,
    tariffKey: tariff.key,
    description: orderDescription,
    grossRub: grossRub - discountRub,
    subscriptionRub: tariff.priceRub - discountRub,
    promoCode,
    discountRub,
    bundleConfig,
    isTest: isTestMode(),
    recurringConsent,
    partnerSlug: partnerRef ? encodePartnerRef(partnerRef) : null,
    referrerOrganizationId: referrer?.id ?? null,
    usePoints,
  });

  if (recurringConsent) {
    // Историю согласий Робокасса требует хранить отдельно: в споре о
    // списании нужно показать, когда согласие дано и какой текст человек
    // видел, а не только текущее состояние флага.
    await db.paymentConsent.create({
      data: {
        email,
        orderId: order.id,
        granted: true,
        statementText: RECURRING_CONSENT_TEXT,
        offerRevision: OFFER_REVISION,
        ipAddress: clientIp(request),
        userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      },
    });
  }

  // Полностью закрыт баллами — кассы в этой дороге нет вообще.
  if (order.paidByPoints) {
    const stored = await db.paymentOrder.findUnique({ where: { id: order.id } });
    if (stored) {
      await completePaidOrder(stored);
    }
    return NextResponse.json({
      paidByPoints: true,
      invId: order.id,
      status: "paid",
      email,
      amountRub: 0,
      pointsSpent: order.pointsSpent,
      description: orderDescription,
      isTest: false,
      needsCompletion: false,
    });
  }

  // Дальше нужна касса. Проверку настроек делаем здесь, а не на входе:
  // оплата баллами обязана работать и на стенде без ключей Робокассы.
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "Приём оплаты пока не настроен. Напишите на support@wesetup.ru" },
      { status: 503 },
    );
  }

  const receiptItems: ReceiptItem[] | undefined = sendReceipt()
    ? [
        {
          name: description.slice(0, 128),
          quantity: 1,
          sum: order.amountRub,
          payment_method: "full_payment",
          payment_object: "service",
          tax: "none",
        },
      ]
    : undefined;

  const params = buildPaymentParams({
    id: order.id,
    amountRub: order.amountRub,
    description: orderDescription,
    email,
    isTest: order.isTest,
    receiptItems,
    recurring: recurringConsent,
  });
  // Ссылка живёт на час меньше холда баллов: оплата в последнюю минуту
  // не должна пересечься с возвратом баллов по крону.
  const paymentParams = {
    ...params,
    ...(order.pointsSpent > 0
      ? { ExpirationDate: expirationDate(new Date()) }
      : {}),
  };

  return NextResponse.json({
    invId: order.id,
    amountRub: order.amountRub,
    pointsSpent: order.pointsSpent,
    description: orderDescription,
    params: paymentParams,
    // Фолбэк на обычную форму оплаты, если iframe-скрипт не загрузился.
    paymentUrl: buildPaymentUrl(paymentParams),
  });
}

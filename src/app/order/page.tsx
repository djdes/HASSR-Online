import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getBalance } from "@/lib/balance/ledger";
import { readTariffs, fallbackTariffs, TARIFF_BUNDLE } from "@/lib/tariffs";
import { normalizeHardwareConfig, hardwareTotal } from "@/lib/hardware-pricing";
import { getDisplayOffer } from "@/lib/promo/offer";
import { resolveCheckoutDiscount } from "@/lib/promo/checkout";
import { discountForPrice, discountLabel, type AppliedDiscount } from "@/lib/promo/discounts";
import { PROMO_COOKIE } from "@/lib/promo/personal-link";
import { OrderClient, type OrderDiscountState } from "./order-client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isMobileAppRequest, MOBILE_APP_HOME } from "@/lib/mobile-app-payments";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Страница оформления и результата оплаты.
 *
 * Адрес зафиксирован в кабинете Робокассы как SuccessURL и FailURL
 * (`https://wesetup.ru/order/`), поэтому она же обслуживает возврат
 * пользователя после оплаты. Три состояния разбираются по query —
 * см. OrderClient.
 *
 * noindex: страница транзакционная, в поиске ей делать нечего.
 */
export const metadata = {
  title: "Оформление подписки",
  robots: { index: false, follow: false },
};

export default async function OrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Оформление и оплата — не в приложении (правила магазинов).
  if (await isMobileAppRequest()) redirect(MOBILE_APP_HOME);
  const params = await searchParams;
  const first = (key: string): string => {
    const value = params[key];
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  };

  const tariffs = await readTariffs().catch(() => fallbackTariffs());

  // Залогиненного не переспрашиваем о почте: после мгновенной
  // регистрации он мог сразу нажать «Оплатить картой».
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionEmail = session?.user?.email ?? "";

  const planKey = first("plan") || "monthly";
  const tariff = tariffs.find((t) => t.key === planKey && t.active) ?? null;

  // Состав корзины приезжает из калькулятора base64-строкой. Здесь он
  // нужен только чтобы показать сумму — платёжную сумму всё равно
  // пересчитает сервер в /api/payments/robokassa/create.
  let bundleConfig: Record<string, number> | null = null;
  if (tariff?.key === TARIFF_BUNDLE) {
    bundleConfig = normalizeHardwareConfig(decodeConfig(first("cfg")));
  }

  // Цена подписки с действующей акцией — та же, что на витринах. Здесь
  // она только для показа: сумму к оплате заново посчитает сервер при
  // создании заказа и сверит с этой (акция могла кончиться, пока открыта
  // страница).
  const offer = tariff ? await getDisplayOffer(tariff) : null;
  const amountRub = offer
    ? offer.priceRub + (bundleConfig ? hardwareTotal(bundleConfig) : 0)
    : 0;

  // Баллы показываем только тому, кто может распоряжаться деньгами
  // организации. ROOT в режиме «войти как» баллы клиента не тратит —
  // ни тумблера, ни списания (сервер откажет так же).
  const canSpendPoints =
    Boolean(session?.user) &&
    hasFullWorkspaceAccess(session!.user) &&
    !isImpersonating(session!);
  const pointsAvailable = canSpendPoints
    ? await getBalance(getActiveOrgId(session!)).catch(() => 0)
    : 0;

  // Промокод из `?promo=` (ссылка /promo/CODE, страница тарифа) или из
  // cookie ссылки; скидка навсегда вошедшего аккаунта — сама. Считает та
  // же функция, что и создание заказа, — здесь только для показа.
  const isCheckout = !first("InvId") && !first("complete");
  const promoParam = Array.isArray(params.promo) ? params.promo[0] : params.promo;
  const cookieCode = promoParam === undefined ? ((await cookies()).get(PROMO_COOKIE)?.value ?? null) : null;
  const promoRaw = (promoParam ?? cookieCode ?? "").trim() || null;
  const codeSource: "query" | "cookie" | null = promoParam ? "query" : cookieCode ? "cookie" : null;
  const discount =
    offer && isCheckout
      ? await resolveCheckoutDiscount({
          promoRaw,
          organizationId: canSpendPoints ? getActiveOrgId(session!) : null,
          email: sessionEmail || null,
          offerRub: offer.priceRub,
          now: new Date(),
          scope: `page:/order${codeSource ? ` (code from ${codeSource})` : ""}`,
        }).catch((error) => {
          console.error("[promo] order page discount failed", error);
          return null;
        })
      : null;
  const withLabel = (applied: AppliedDiscount | null) =>
    applied ? { ...applied, label: discountLabel(applied) } : null;
  const lifetimeFallback: AppliedDiscount | null =
    discount && !discount.ok && discount.lifetime && offer
      ? {
          source: "lifetime",
          code: discount.lifetime.code,
          kind: discount.lifetime.kind,
          value: discount.lifetime.value,
          lifetime: true,
          discountRub: discountForPrice(discount.lifetime, offer.priceRub),
          lifetimeDiscountId: discount.lifetime.id,
        }
      : null;
  // Код из cookie, который уже закреплён за аккаунтом скидкой навсегда, —
  // остаток ссылки: ведём себя как без кода (скидка и так применится сама).
  const cookieAlreadyBound =
    codeSource === "cookie" && discount?.ok === true && discount.lifetime?.code === discount.typedCode;
  const keepCode = discount?.ok === true && !cookieAlreadyBound;
  const initialDiscount: OrderDiscountState = {
    applied: withLabel(discount?.ok ? discount.applied : lifetimeFallback),
    // Код из cookie, который не подошёл, в поле не подставляем и ошибкой
    // не показываем: человек его сейчас не вводил.
    typedCode: keepCode && discount?.ok ? discount.typedCode : null,
    input: keepCode || codeSource === "query" ? (promoRaw ?? "") : "",
    error: discount && !discount.ok && codeSource === "query" ? discount.message : null,
    notice: keepCode && discount?.ok ? discount.notice : null,
    personalPending: discount?.ok ? discount.personalPending : false,
  };

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <PublicHeader />
      <main className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6 md:py-14">
        <OrderClient
          tariff={tariff}
          offer={offer}
          bundleConfig={bundleConfig}
          amountRub={amountRub}
          sessionEmail={sessionEmail}
          pointsAvailable={pointsAvailable}
          // Баллами оплачивается только подписка: оборудование —
          // физический товар с себестоимостью.
          pointsCap={offer?.priceRub ?? 0}
          // Пришли из кабинета по кнопке «Включить автопродление».
          recurringDefault={first("recurring") === "1"}
          initialDiscount={initialDiscount}
          returnParams={{
            outSum: first("OutSum"),
            invId: first("InvId"),
            signature: first("SignatureValue"),
            completeToken: first("complete"),
          }}
        />
      </main>
      <PublicFooter />
    </div>
  );
}

function decodeConfig(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getBalance } from "@/lib/balance/ledger";
import type { Tariff } from "@/lib/tariffs";
import { parseCheckoutTarget, quoteCheckout } from "@/lib/plan-checkout.server";
import { formatMskDay } from "@/lib/billing-period";
import { resolveCheckoutDiscount } from "@/lib/promo/checkout";
import { discountForPrice, discountLabel, type AppliedDiscount } from "@/lib/promo/discounts";
import { PROMO_COOKIE } from "@/lib/promo/personal-link";
import { OrderClient, type OrderDiscountState, type OrderPlanView } from "./order-client";
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

  // Залогиненного не переспрашиваем о почте: после мгновенной
  // регистрации он мог сразу нажать «Оплатить картой».
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionEmail = session?.user?.email ?? "";

  // Баллы показываем только тому, кто может распоряжаться деньгами
  // организации. ROOT в режиме «войти как» баллы клиента не тратит —
  // ни тумблера, ни списания (сервер откажет так же).
  const canSpendPoints =
    Boolean(session?.user) &&
    hasFullWorkspaceAccess(session!.user) &&
    !isImpersonating(session!);

  // Тариф, период и точки — из адреса (`plan=premium&cycle=year&points=2`;
  // старые `plan=monthly`/`bundle` ведут на «Стандарт»/«Премиум»). Сумма —
  // по виду перехода от текущей подписки (доплата за остаток, зачёт при
  // переходе на год) с действующей акцией: та же функция, что посчитает
  // заказ (`quoteCheckout`). Здесь — только для показа и сверки.
  const isCheckoutView = !first("InvId") && !first("complete");
  const target = parseCheckoutTarget({ plan: first("plan") || "standard", cycle: first("cycle") || undefined, points: first("points") || undefined });
  const quote =
    target && isCheckoutView
      ? await quoteCheckout({
          organizationId: canSpendPoints ? getActiveOrgId(session!) : null,
          target,
          now: new Date(),
        }).catch((error) => {
          console.error("[billing] order page quote failed", error);
          return null;
        })
      : null;
  const offer = quote?.ok ? quote.offer : null;
  const tariff: Tariff | null = quote?.ok
    ? { key: quote.tariffKey, title: quote.title, priceRub: quote.change.periodPriceRub, periodDays: quote.periodDays, active: true, sort: 0 }
    : null;
  const plan: OrderPlanView | null = quote?.ok
    ? {
        tier: quote.target.tier,
        cycle: quote.target.cycle,
        points: quote.target.points,
        kind: quote.change.kind,
        periodPriceRub: quote.change.periodPriceRub,
        creditRub: quote.change.creditRub,
        differenceRub: quote.change.differenceRub,
        remainingDays: quote.change.remainingDays,
        periodStartLabel: formatMskDay(quote.change.periodStart),
        periodEndLabel: formatMskDay(quote.change.periodEnd),
      }
    : null;
  const refusal = quote && !quote.ok && quote.code !== "unavailable" ? quote.error : null;
  const amountRub = offer ? offer.priceRub : 0;
  const pointsAvailable = canSpendPoints
    ? await getBalance(getActiveOrgId(session!)).catch(() => 0)
    : 0;

  // Промокод из `?promo=` (ссылка /promo/CODE, страница тарифа) или из
  // cookie ссылки; скидка навсегда вошедшего аккаунта — сама. Считает та
  // же функция, что и создание заказа, — здесь только для показа.
  const isCheckout = isCheckoutView;
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
          expiresAt: discount.lifetime.expiresAt ?? null,
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
          plan={plan}
          refusal={refusal}
          bundleConfig={null}
          amountRub={amountRub}
          sessionEmail={sessionEmail}
          pointsAvailable={pointsAvailable}
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


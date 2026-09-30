import { Coins, FlaskConical, Users } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth, getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { ClosingDocumentActions } from "@/components/settings/closing-document-actions";
import { readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { isRequisitesComplete } from "@/lib/closing-documents/types";
import { InvoiceCard } from "@/components/settings/invoice-card";
import { invoiceRequisitesReady } from "@/lib/invoices/build";
import { orderStatusLabel } from "@/lib/order-status";
import { PlanUpgrade } from "@/components/settings/plan-upgrade";
import { ResumePausedCard } from "@/components/settings/resume-paused-card";
import { pricingScaleRows, quoteSubscription } from "@/lib/subscription-pricing";
import {
  EXTRA_USER_PRICE_RUB,
  FREE_PLAN_NOTE,
  FREE_SEATS_LABEL,
  SUBSCRIPTION_MAX_USERS,
  SUBSCRIPTION_SEATS_LABEL,
} from "@/lib/plan-catalog";
import { formatMskDay, lastFreeDay } from "@/lib/billing-period";
import { loadBillingView } from "@/lib/billing-view.server";
import {
  BillingTransitionGate,
  type TransitionGateCopy,
} from "@/components/billing/billing-transition-gate";
import { HARDWARE_BUNDLES, bundleTotal } from "@/lib/hardware-pricing";
import {
  readTariffs,
  fallbackTariffs,
  TARIFF_MONTHLY,
} from "@/lib/tariffs";
import {
  BILLING_TEST_MODE,
  FREE_MAX_USERS,
  isFreePlan,
  planLabel,
} from "@/lib/plan-limits";
import { RecurringCard } from "@/components/settings/recurring-card";
import { PromoBadge, PromoPrice } from "@/components/pricing/promo-price";
import { SubscriptionDiscountCard } from "@/components/settings/subscription-discount-card";
import { resolveCheckoutDiscount } from "@/lib/promo/checkout";
import { discountForPrice, type AppliedDiscount } from "@/lib/promo/discounts";
import { getDisplayOffer } from "@/lib/promo/offer";
import { PROMO_COOKIE } from "@/lib/promo/personal-link";
import { applyPromotion } from "@/lib/promo/promotions";
import { isMobileAppRequest } from "@/lib/mobile-app-payments";
import { isTopupOrder } from "@/lib/balance/topup-core";

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Раньше здесь стоял `requireRole(["owner"])`, и страница была
  // недостижима: normalizeUserRole переводит legacy-«owner» в «manager»,
  // так что список ["owner"] не совпадал ни с кем. Тариф правит тот же,
  // кто имеет полный доступ к кабинету, — как и в POST /upgrade.
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    redirect("/dashboard");
  }

  const org = await db.organization.findUnique({
    where: { id: getActiveOrgId(session) },
    select: {
      subscriptionPlan: true,
      subscriptionEnd: true,
      recurringActive: true,
      isDemo: true,
      balanceRub: true,
      inn: true,
      name: true,
      _count: { select: { users: { where: { isActive: true } } } },
    },
  });

  // В демо-организации сотрудники тестовые и в тариф не входят — иначе
  // калькулятор показал бы «15 человек» и цену, которой не будет.
  const isDemo = org?.isDemo === true;
  const plan = org?.subscriptionPlan ?? "free";

  // Бесплатный период и переход на оплату (2026-10): тариф и численность
  // считаются по аккаунту, как в шапке и в проверке мест.
  const inMobileApp = await isMobileAppRequest();
  const billing = await loadBillingView({
    organizationId: getActiveOrgId(session),
    user: session.user,
    impersonating: isImpersonating(session),
    partnerAccess: Boolean(session.user.partnerAccess),
    inMobileApp,
  }).catch((error) => {
    console.error("[billing] subscription page view failed", error);
    return null;
  });
  const kind = billing?.state.kind ?? "legacy";
  const employees = isDemo
    ? 1
    : billing && !billing.unit.exempt
      ? Math.max(1, billing.unit.activeUsers)
      : org?._count.users || 1;
  // Какая карточка витрины «текущая»: реально оплачено и бесплатный
  // период — подписка; после периода без оплаты — бесплатный.
  const shownPlan =
    kind === "paid" || kind === "free_period"
      ? "paid"
      : kind === "free" || kind === "needs_decision"
        ? "free"
        : plan;
  const shownPlanLabel =
    kind === "paid"
      ? `Подписка${billing?.state.paidUntil ? ` до ${formatMskDay(billing.state.paidUntil)}` : ""}`
      : kind === "free_period" && billing
        ? `Подписка — бесплатно по ${formatMskDay(lastFreeDay(billing.settings))}`
        : kind === "needs_decision"
          ? "Бесплатный период закончился"
          : kind === "free"
            ? "Бесплатный"
            : planLabel(plan);
  // Надписи «тестовый режим — оплата не списывается» — только до
  // перехода на оплату: после него это была бы неправда.
  const testModeActive = billing ? billing.testModeActive : BILLING_TEST_MODE;
  const paymentRequired =
    billing?.state.enforcement === true && kind !== "paid" && kind !== "exempt";
  // Развилка «оплатить / бесплатный» — карточкой вверху страницы (окно
  // на этой странице не показываем: оно закрыло бы саму оплату).
  const decisionCopy: TransitionGateCopy | null = billing?.gate?.copy ?? null;
  const decisionReadOnly =
    kind === "needs_decision" && !billing?.state.inactive && !decisionCopy;
  // Условие бесплатного тарифа — одной строкой под названием плана.
  // null на платном.
  const planNote = isFreePlan(shownPlan) ? FREE_PLAN_NOTE : null;
  // Та же цифра, что в карточке железа на лендинге — считаем из одного
  // источника, чтобы витрины не разъехались.
  const hardwareFromRub = Math.min(...HARDWARE_BUNDLES.map(bundleTotal));
  // Цена подписки живёт в БД и правится ROOT'ом — калькулятор берёт её
  // оттуда же, что и лендинг, иначе итоги на двух витринах разойдутся.
  const tariffs = await readTariffs().catch(() => fallbackTariffs());
  const monthly =
    tariffs.find((t) => t.key === TARIFF_MONTHLY) ?? fallbackTariffs()[0];
  const price = quoteSubscription(employees, monthly.priceRub);
  // Действующая акция — на всю сумму подписки (база + доплата сверх
  // лимита); та же цена уйдёт в заказ и счёт (lib/promo/offer.ts).
  const offer = await getDisplayOffer(monthly);
  const monthlyWithPromotion = applyPromotion(price.monthlyRub, offer.promotion);
  // Промокод: `?promo=` (из ссылки /promo/CODE или поля ниже), иначе код
  // из cookie ссылки. Пустой `?promo=` — явно без кода. Скидку (код или
  // скидка навсегда аккаунта — выгоднейшая) считает сервер, как при оплате.
  const params = await searchParams;
  const promoParam = Array.isArray(params.promo) ? params.promo[0] : params.promo;
  const cookieCode = promoParam === undefined ? ((await cookies()).get(PROMO_COOKIE)?.value ?? null) : null;
  const promoRaw = (promoParam ?? cookieCode ?? "").trim() || null;
  const codeSource = promoParam ? "query" : cookieCode ? "cookie" : null;
  const discount =
    inMobileApp || isDemo
      ? null
      : await resolveCheckoutDiscount({
          promoRaw,
          organizationId: getActiveOrgId(session),
          email: session.user.email ?? null,
          offerRub: offer.priceRub,
          now: new Date(),
          scope: `page:/settings/subscription${codeSource ? ` (code from ${codeSource})` : ""}`,
        }).catch((error) => {
          console.error("[promo] subscription page discount failed", error);
          return null;
        });
  // Код не подошёл — скидка навсегда аккаунта всё равно действует.
  const lifetime = discount?.lifetime ?? null;
  const appliedDiscount: AppliedDiscount | null = discount?.ok
    ? discount.applied
    : lifetime
      ? {
          source: "lifetime",
          code: lifetime.code,
          kind: lifetime.kind,
          value: lifetime.value,
          lifetime: true,
          discountRub: discountForPrice(lifetime, offer.priceRub),
          lifetimeDiscountId: lifetime.id,
        }
      : null;
  // Код из cookie, который не подошёл, не показываем ошибкой: человек его
  // сейчас не вводил. Код из адреса — показываем причину. Код из cookie,
  // уже закреплённый скидкой навсегда, — остаток ссылки: как без кода.
  const cookieAlreadyBound =
    codeSource === "cookie" && discount?.ok === true && lifetime?.code === discount.typedCode;
  const acceptedCode = discount?.ok && !cookieAlreadyBound ? discount.typedCode : null;
  const promoError = discount && !discount.ok && codeSource !== "cookie" ? discount.message : null;
  const payHref = acceptedCode
    ? `/order?plan=monthly&promo=${encodeURIComponent(acceptedCode)}`
    : "/order?plan=monthly";
  // Следующее автосписание — по цене тарифа со скидкой навсегда (акция к
  // тому дню может закончиться, поэтому от цены без неё).
  const recurringMonthlyRub = lifetime
    ? monthly.priceRub - discountForPrice(lifetime, monthly.priceRub)
    : monthly.priceRub;
  const discountFirst = codeSource === "query" || Boolean(lifetime);
  const discountCard = isDemo ? null : (
    <SubscriptionDiscountCard
      offer={offer}
      periodDays={monthly.periodDays}
      lifetime={lifetime}
      applied={appliedDiscount}
      typedCode={codeSource === "cookie" && !acceptedCode ? null : promoRaw}
      error={promoError}
      notice={discount?.ok && !cookieAlreadyBound ? discount.notice : null}
      personalPending={discount?.ok ? discount.personalPending : false}
      payHref={payHref}
    />
  );
  // Пример для справки: команда чуть больше подписки — видно и базу,
  // и доплату.
  const exampleEmployees = SUBSCRIPTION_MAX_USERS + 5;
  const example = quoteSubscription(exampleEmployees, monthly.priceRub);
  // История платежей организации. Только проведённые идут в итог: заказ
  // в статусе pending денег не принёс, и складывать его в «оплачено»
  // значит показывать выручку, которой нет.
  const payments = await db.paymentOrder.findMany({
    where: { organizationId: getActiveOrgId(session) },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      description: true,
      amountRub: true,
      status: true,
      isTest: true,
      paidAt: true,
      createdAt: true,
      pointsSpent: true,
      refundedAt: true,
      paymentMethod: true,
      invoiceDueAt: true,
      tariffKey: true,
    },
  });
  const paidTotalRub = payments
    .filter((payment) => payment.status === "paid" && !payment.isTest)
    .reduce((sum, payment) => sum + Number(payment.amountRub), 0);
  // Закрывающие документы выпускаются, только когда WeSetup заполнил свои
  // реквизиты и факсимиле; до этого колонка молчит. Документ — по
  // оплаченному деньгами, не тестовому и не возвращённому заказу.
  const platformRequisites = await readPlatformRequisites();
  const documentsReady = isRequisitesComplete(platformRequisites);
  // Счёт по безналу: нужны реквизиты и банк исполнителя, картинки — нет.
  const invoiceReady = invoiceRequisitesReady(platformRequisites);
  // Счёт на пополнение баланса — не счёт на подписку: он живёт в «Баланс и
  // бонусы», здесь карточку подписки не подменяет.
  const pendingInvoice = payments.find(
    (payment) =>
      payment.paymentMethod === "invoice" && payment.status === "pending" && !isTopupOrder(payment)
  );
  // УПД — на любую оплату деньгами, в том числе на пополнение баланса.
  const closingEligible = (payment: (typeof payments)[number]) =>
    documentsReady &&
    payment.status === "paid" &&
    !payment.isTest &&
    !payment.refundedAt &&
    Number(payment.amountRub) > 0;

  // Приложение WeSetup: только состояние тарифа, без оплаты, счетов и
  // ссылок на оплату (App Store 3.1.1 / 3.1.3(b), Google Play).
  if (inMobileApp) {
    const activeUntil =
      billing?.state.paidUntil ?? (isFreePlan(plan) ? null : (org?.subscriptionEnd ?? null));
    return (
      <InAppSubscriptionStatus
        decisionCopy={decisionCopy}
        planLabel={shownPlanLabel}
        planNote={planNote}
        paused={plan === "paused"}
        activeUntil={activeUntil}
        expired={activeUntil !== null && activeUntil.getTime() < new Date().getTime()}
        employees={employees}
        balanceRub={org?.balanceRub ?? 0}
        payments={payments.map((payment) => ({
          id: payment.id,
          at: payment.paidAt ?? payment.createdAt,
          description: payment.description,
          status: orderStatusLabel(payment),
          paid: payment.status === "paid",
          amountRub: Number(payment.amountRub),
        }))}
      />
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
        Улучшение тарифа
      </h1>

      {isDemo ? (
        <div className="flex items-start gap-3 rounded-2xl border border-[#dcdfed] bg-[#f5f6ff] px-4 py-3 text-[13.5px] leading-[1.5] text-[#3848c7]">
          <FlaskConical className="mt-0.5 size-4 shrink-0" />
          <span>
            Это демо-организация — её сотрудники не учитываются в тарифе.
            Тариф общий для аккаунта и настраивается из вашей организации.
          </span>
        </div>
      ) : null}

      {/* Баллы над тарифами: их спишут при оплате автоматически, и
          человек должен видеть это ДО того, как выберет тариф. */}
      {(org?.balanceRub ?? 0) > 0 ? (
        <Link
          href="/settings/balance"
          className="flex items-start gap-3 rounded-2xl border border-[#dcdfed] bg-[#f5f6ff] px-4 py-3 text-[13.5px] leading-[1.5] text-[#3848c7] transition-colors hover:border-[#5566f6]/40"
        >
          <Coins className="mt-0.5 size-4 shrink-0" />
          <span>
            На балансе{" "}
            <strong className="tabular-nums">
              {(org?.balanceRub ?? 0).toLocaleString("ru-RU")} ₽
            </strong>{" "}
            — спишутся при оплате подписки. Как заработать ещё — в разделе
            «Баланс и бонусы».
          </span>
        </Link>
      ) : null}

      {decisionCopy ? (
        <BillingTransitionGate
          display="card"
          copy={decisionCopy}
          payHref={payHref}
          blocking={false}
          cardNote={
            invoiceReady && !isDemo
              ? "Оплатить можно и счётом по безналу — блок «Оплата по безналу для юрлиц» ниже."
              : null
          }
        />
      ) : null}
      {decisionReadOnly ? (
        <p className="rounded-2xl border border-[#ffd9a8] bg-[#fffaf0] px-4 py-3 text-[13.5px] leading-[1.5] text-[#7a4a00]">
          Бесплатный период подписки закончился. Оплатить подписку или перейти
          на бесплатный тариф может руководитель организации в своём кабинете.
        </p>
      ) : null}

      {/* Витрина тарифов — главное на странице, поэтому первым блоком.
          Раньше здесь висел SubscriptionManager с мёртвыми
          starter/standard/pro, которые никогда не писались в БД. */}
      {plan === "paused" ? <ResumePausedCard /> : null}

      {/* Пришли по ссылке с промокодом или уже есть скидка навсегда —
          карточка скидки первой: ради неё человек и открыл страницу. */}
      {discountFirst ? discountCard : null}

      <PlanUpgrade
        currentPlan={shownPlan}
        currentPlanLabel={shownPlanLabel}
        planNote={planNote}
        activeUsers={employees}
        freeUserLimit={FREE_MAX_USERS}
        billingTestMode={testModeActive}
        paymentRequired={paymentRequired}
        hardwareFromRub={hardwareFromRub}
        subscriptionMonthly={monthly.priceRub}
        subscriptionPromotion={offer.promotion}
        subscriptionDiscount={appliedDiscount}
        payHref={payHref}
      />

      {discountFirst ? null : discountCard}

      {!isDemo ? (
        <InvoiceCard
          ready={invoiceReady}
          orgName={org?.name ?? "организацию"}
          orgInn={org?.inn ?? null}
          amountRub={monthly.priceRub}
          promotion={offer.promotion}
          discount={appliedDiscount}
          promoCode={acceptedCode}
          periodDays={monthly.periodDays}
          pending={
            pendingInvoice
              ? {
                  id: pendingInvoice.id,
                  amountRub: Number(pendingInvoice.amountRub),
                  dueAt: pendingInvoice.invoiceDueAt?.toISOString() ?? null,
                }
              : null
          }
        />
      ) : null}

      <RecurringCard
        active={org?.recurringActive === true}
        nextChargeAt={org?.subscriptionEnd?.toISOString() ?? null}
        monthlyRub={recurringMonthlyRub}
      />

      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="text-[16px] font-semibold text-[#0b1024]">
            История платежей
          </span>
          {paidTotalRub > 0 ? (
            <span className="text-[13.5px] text-[#6f7282]">
              Оплачено за всё время:{" "}
              <span className="font-semibold tabular-nums text-[#0b1024]">
                {paidTotalRub.toLocaleString("ru-RU")} ₽
              </span>
            </span>
          ) : null}
        </div>

        {documentsReady && !org?.inn && payments.some(closingEligible) ? (
          <p className="mt-3 rounded-2xl bg-[#fff8eb] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#b25f00]">
            В закрывающих документах пока только название организации. Укажите ИНН в{" "}
            <Link href="/settings/organization" className="underline underline-offset-2">
              настройках организации
            </Link>{" "}
            и нажмите «обновить» рядом с документом — реквизиты покупателя подставятся.
          </p>
        ) : null}

        {payments.length === 0 ? (
          <p className="mt-4 text-[13.5px] text-[#9b9fb3]">
            Платежей пока не было.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-[#9b9fb3]">
                  <th className="pb-2 font-medium">Дата и время</th>
                  <th className="pb-2 font-medium">Назначение</th>
                  <th className="pb-2 font-medium">Статус</th>
                  <th className="pb-2 text-right font-medium">Сумма</th>
                  <th className="pb-2 pl-4 font-medium">Документы</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-t border-[#f2f3f8]">
                    <td className="py-2.5 text-[#0b1024]">
                      {(payment.paidAt ?? payment.createdAt).toLocaleString("ru-RU")}
                    </td>
                    <td className="py-2.5 text-[#6f7282]">
                      {payment.description}
                      {/* Тестовый платёж помечаем и не считаем в итог —
                          иначе «оплачено» покажет деньги, которых не было. */}
                      {payment.isTest ? (
                        <span className="ml-2 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] text-[#6f7282]">
                          тест
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={
                          payment.status === "paid"
                            ? "rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[12px] text-[#116b2a]"
                            : "rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[12px] text-[#6f7282]"
                        }
                      >
                        {orderStatusLabel(payment)}
                      </span>
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-[#0b1024]">
                      {Number(payment.amountRub).toLocaleString("ru-RU")} ₽
                      {payment.pointsSpent > 0 ? (
                        <div className="text-[12px] text-[#3848c7]">
                          баллами −{payment.pointsSpent.toLocaleString("ru-RU")}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2.5 pl-4">
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {payment.paymentMethod === "invoice" && payment.status !== "cancelled" ? (
                          <a
                            href={`/api/payments/invoice/${payment.id}/pdf`}
                            className="inline-flex h-8 items-center rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                          >
                            Счёт (PDF)
                          </a>
                        ) : null}
                        {closingEligible(payment) ? (
                          <ClosingDocumentActions orderId={payment.id} canRefresh={Boolean(org?.inn)} />
                        ) : null}
                        {!closingEligible(payment) &&
                        !(payment.paymentMethod === "invoice" && payment.status !== "cancelled") ? (
                          <span className="text-[#c9ccdb]">—</span>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Расчёт по числу сотрудников — «как считается платный тариф».
          Справка второго уровня: нужна тем, кто уже решил улучшать. */}
      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <Coins className="size-5" />
          </span>
          <div className="flex-1">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
              Как считается стоимость
            </h2>
            <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-[#6f7282]">
              {FREE_SEATS_LABEL} — бесплатно. Команда {SUBSCRIPTION_SEATS_LABEL} —
              одна подписка{" "}
              <PromoPrice price={offer} size="text" tone="inherit" suffix="/мес" showBadge={false} />{" "}
              на всех, не за человека. Каждый сотрудник сверх{" "}
              {SUBSCRIPTION_MAX_USERS} — {`+${EXTRA_USER_PRICE_RUB} ₽/мес.`}
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <PricingStat
                label="Активных"
                value={String(employees)}
                hint={
                  <span className="inline-flex items-center gap-1 text-[#6f7282]">
                    <Users className="size-3" /> {price.tierLabel}
                  </span>
                }
              />
              <PricingStat
                label={`Сверх ${SUBSCRIPTION_MAX_USERS}`}
                value={String(price.extraEmployees)}
                hint={
                  <span className="text-[#6f7282]">
                    {price.extraEmployees > 0
                      ? `+${EXTRA_USER_PRICE_RUB} ₽/мес за каждого`
                      : "входит в подписку"}
                  </span>
                }
              />
              <PricingStat
                label="В месяц"
                value={
                  price.isFree ? (
                    "0 ₽"
                  ) : monthlyWithPromotion.promotion || appliedDiscount ? (
                    <PromoPrice
                      price={monthlyWithPromotion}
                      personal={appliedDiscount}
                      size="lg"
                      layout="stacked"
                    />
                  ) : (
                    `${price.monthlyRub.toLocaleString("ru-RU")} ₽`
                  )
                }
                hint={
                  price.isFree ? (
                    <span className="font-medium text-[#116b2a]">
                      Бесплатно
                    </span>
                  ) : (
                    // Годового тарифа нет — ×12 только для ориентира.
                    <span className="text-[#6f7282]">
                      {price.yearlyRub.toLocaleString("ru-RU")} ₽/год без скидки
                    </span>
                  )
                }
                accent={price.isFree}
              />
            </div>

            <div className="mt-5 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[13px] leading-relaxed text-[#6f7282]">
              <strong className="text-[#0b1024]">Шкала тарифов:</strong>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {pricingScaleRows(monthly.priceRub).map((row) => (
                  <li key={row.range}>
                    {row.range}: {row.price}
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                Например, {exampleEmployees} сотрудников:{" "}
                {example.baseRub.toLocaleString("ru-RU")} +{" "}
                {example.extraEmployees} × {EXTRA_USER_PRICE_RUB} ={" "}
                {example.monthlyRub.toLocaleString("ru-RU")} ₽/мес.
              </p>
              {offer.promotion ? (
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[#3c4053]">
                  <span>Сейчас акция «{offer.promotion.title}»:</span>
                  <PromoBadge promotion={offer.promotion} />
                  <span>на всю сумму подписки, вместе с доплатой сверх {SUBSCRIPTION_MAX_USERS}.</span>
                </p>
              ) : null}
              {testModeActive ? (
                <p className="mt-3 text-[#3c4053]">
                  Пока сайт в тестовом режиме, суммы выше — справочные:
                  оплата не списывается.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function PricingStat({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: React.ReactNode;
  hint: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3"
      style={
        accent
          ? { borderColor: "#7cf5c0", backgroundColor: "#ecfdf5" }
          : undefined
      }
    >
      <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#6f7282]">
        {label}
      </div>
      <div className="mt-1 text-[26px] font-semibold leading-none tabular-nums text-[#0b1024]">
        {value}
      </div>
      <div className="mt-1.5 text-[12px]">{hint}</div>
    </div>
  );
}

/**
 * Тариф в приложении WeSetup: только состояние. Ни кнопок оплаты, ни
 * счетов, ни слов «оплатите на сайте» — правила App Store и Google Play
 * запрещают звать к оплате мимо магазина. Возобновить работу после
 * паузы можно: это бесплатно.
 */
function InAppSubscriptionStatus({
  decisionCopy,
  planLabel: label,
  planNote,
  paused,
  activeUntil,
  expired,
  employees,
  balanceRub,
  payments,
}: {
  /** Развилка после бесплатного периода — без кнопки оплаты (правила сторов). */
  decisionCopy: TransitionGateCopy | null;
  planLabel: string;
  planNote: string | null;
  paused: boolean;
  activeUntil: Date | null;
  expired: boolean;
  employees: number;
  balanceRub: number;
  payments: Array<{
    id: number;
    at: Date;
    description: string;
    status: string;
    paid: boolean;
    amountRub: number;
  }>;
}) {
  return (
    <div className="space-y-5">
      <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
        Тариф
      </h1>

      {decisionCopy ? (
        <BillingTransitionGate display="card" copy={decisionCopy} payHref={null} blocking={false} />
      ) : null}

      {paused ? <ResumePausedCard /> : null}

      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
        <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          Тариф компании
        </div>
        <div className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
          {label}
        </div>
        {planNote ? (
          <p className="mt-1.5 text-[13.5px] leading-[1.5] text-[#6f7282]">{planNote}</p>
        ) : null}

        {expired ? (
          <p
            data-testid="subscription-expired"
            className="mt-4 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[14px] leading-[1.5] text-[#a13a32]"
          >
            Подписка компании закончилась. Обратитесь к владельцу компании.
          </p>
        ) : null}

        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          <StatusCell
            label={expired ? "Закончилась" : "Действует до"}
            value={activeUntil ? activeUntil.toLocaleDateString("ru-RU") : "без срока"}
          />
          <StatusCell label="Сотрудников" value={String(employees)} />
          <StatusCell label="Баланс баллов" value={`${balanceRub.toLocaleString("ru-RU")} ₽`} />
        </dl>
      </section>

      {payments.length > 0 ? (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">История платежей</h2>
          <ul className="mt-3 divide-y divide-[#f2f3f8]">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-[14px] text-[#0b1024]">{payment.description}</div>
                  <div className="mt-0.5 text-[12.5px] text-[#6f7282]">
                    {payment.at.toLocaleDateString("ru-RU")} · {payment.status}
                  </div>
                </div>
                <div
                  className={`shrink-0 text-[14px] tabular-nums ${payment.paid ? "text-[#0b1024]" : "text-[#6f7282]"}`}
                >
                  {payment.amountRub.toLocaleString("ru-RU")} ₽
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
      <dt className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#6f7282]">
        {label}
      </dt>
      <dd className="mt-1 text-[18px] font-semibold tabular-nums text-[#0b1024]">{value}</dd>
    </div>
  );
}

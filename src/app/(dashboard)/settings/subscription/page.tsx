import { Coins, FlaskConical, HardDrive, Layers, MapPin, Users } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { ClosingDocumentActions } from "@/components/settings/closing-document-actions";
import { readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { isRequisitesComplete } from "@/lib/closing-documents/types";
import { InvoiceCard, type InvoiceOption } from "@/components/settings/invoice-card";
import { invoiceRequisitesReady } from "@/lib/invoices/build";
import { orderStatusLabel } from "@/lib/order-status";
import { ResumePausedCard } from "@/components/settings/resume-paused-card";
import { CabinetTariffs, CancelScheduleButton } from "@/components/settings/cabinet-tariffs";
import { EquipmentDeliveryCard } from "@/components/settings/equipment-delivery-card";
import { formatBytes, formatMskDay, hasFeature, lastDayBefore, voluntaryDowngradeCheck, type AccountBillingState } from "@/lib/billing-period";
import { loadStorageSummary, type StorageSummary } from "@/lib/billing.server";
import { tariffName } from "@/lib/cabinet-plan";
import { loadBillingView } from "@/lib/billing-view.server";
import {
  BillingTransitionGate,
  VoluntaryFreeButton,
  type TransitionGateCopy,
} from "@/components/billing/billing-transition-gate";
import { readPlanPricing } from "@/lib/tariffs";
import { BILLING_TEST_MODE, FREE_MAX_USERS, isFreePlan } from "@/lib/plan-limits";
import { RecurringCard } from "@/components/settings/recurring-card";
import { PromoBadge } from "@/components/pricing/promo-price";
import { SubscriptionDiscountCard } from "@/components/settings/subscription-discount-card";
import { resolveCheckoutDiscount } from "@/lib/promo/checkout";
import { discountForPrice, type AppliedDiscount } from "@/lib/promo/discounts";
import { readActivePromotion } from "@/lib/promo/offer";
import { PROMO_COOKIE } from "@/lib/promo/personal-link";
import { applyPromotion } from "@/lib/promo/promotions";
import { isMobileAppRequest } from "@/lib/mobile-app-payments";
import { isTopupOrder } from "@/lib/balance/topup-core";
import { readPpkIndividualPrice } from "@/lib/services/catalog";
import {
  FREE_MAX_JOURNALS,
  POINTS_DISCOUNT_FROM,
  POINTS_DISCOUNT_PERCENT,
  SEATS_PER_POINT,
  TRIAL_DAYS,
  planMonthlyRub,
  planPeriodPriceRub,
  quotePlanChange,
  type BillingCycle,
  type CurrentSubscription,
  type PaidTier,
  type PlanTarget,
} from "@/lib/tariff-plans";

/** Примеры цены за месяц по числу точек (оплата за год). */
const EXAMPLE_POINTS = [1, 2, 3, 5] as const;

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Раньше здесь стоял `requireRole(["owner"])`, и страница была
  // недостижима: normalizeUserRole переводит legacy-«owner» в «manager»,
  // так что список ["owner"] не совпадал ни с кем. Тариф правит тот же,
  // кто имеет полный доступ к кабинету, — как и в POST /upgrade.
  const t = await getTranslations("settingsUi.subscriptionPage");
  const tt = await getTranslations("landingComponents.tariffs");
  const locale = await getLocale();
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    redirect("/dashboard");
  }
  const orgId = getActiveOrgId(session);

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      subscriptionPlan: true,
      subscriptionEnd: true,
      recurringActive: true,
      isDemo: true,
      balanceRub: true,
      inn: true,
      name: true,
      phone: true,
      address: true,
      _count: { select: { users: { where: { isActive: true } } } },
    },
  });

  // В демо-организации сотрудники тестовые и в тариф не входят.
  const isDemo = org?.isDemo === true;
  const plan = org?.subscriptionPlan ?? "free";

  // Тарифы 2026-10: состояние, численность, точки и журналы — по аккаунту,
  // как в шапке и в проверках лимитов.
  const inMobileApp = await isMobileAppRequest();
  const now = new Date();
  const billing = await loadBillingView({
    organizationId: orgId,
    user: session.user,
    impersonating: isImpersonating(session),
    partnerAccess: Boolean(session.user.partnerAccess),
    inMobileApp,
    now,
  }).catch((error) => {
    console.error("[billing] subscription page view failed", error);
    return null;
  });
  const state: AccountBillingState | null = billing?.state ?? null;
  const kind = state?.kind ?? "legacy";
  const employees = isDemo
    ? 1
    : billing && !billing.unit.exempt
      ? Math.max(1, billing.unit.activeUsers)
      : org?._count.users || 1;

  const tierName = (tier: PaidTier) => (tier === "standard" ? tt("tiers.standard.name") : tt("tiers.premium.name"));
  const cycleLabel = (cycle: BillingCycle) => (cycle === "year" ? t("cycleYear") : t("cycleMonth"));
  const planLine = (target: PlanTarget) =>
    [tierName(target.tier), cycleLabel(target.cycle), t("pointsCount", { count: target.points })].join(" · ");

  const paidTier = state?.kind === "paid" ? state.paidTier : null;
  const shownPlanLabel =
    kind === "paid"
      ? paidTier && paidTier !== "legacy"
        ? state?.paidUntil
          ? t("planPaidUntil", { plan: tierName(paidTier), date: formatMskDay(state.paidUntil) })
          : t("planPaid", { plan: tierName(paidTier) })
        : state?.paidUntil
          ? t("planPaidUntil", { plan: t("planLegacy"), date: formatMskDay(state.paidUntil) })
          : t("planLegacy")
      : kind === "free_period" && state?.trialEndsAt
        ? t("planTrial", { date: formatMskDay(lastDayBefore(state.trialEndsAt)) })
        : kind === "needs_decision"
          ? t("planNeedsDecision")
          : kind === "free"
            ? t("planFree")
            : tariffName(plan);
  // Надписи «тестовый режим — оплата не списывается» — только до
  // перехода на оплату: после него это была бы неправда.
  const testModeActive = billing ? billing.testModeActive : BILLING_TEST_MODE;
  // Развилка «оплатить / бесплатный» — карточкой вверху страницы (окно
  // на этой странице не показываем: оно закрыло бы саму оплату).
  const decisionCopy: TransitionGateCopy | null = billing?.gate?.copy ?? null;
  const decisionReadOnly = kind === "needs_decision" && !state?.inactive && !decisionCopy;
  // «Перейти на бесплатный» по своей воле — с платного тарифа или из
  // пробного. Решает руководитель в своём кабинете: не ROOT «под видом» и
  // не консультант (как в API перехода).
  const voluntaryFree =
    billing &&
    !isDemo &&
    !billing.unit.exempt &&
    (kind === "paid" || kind === "free_period") &&
    !isImpersonating(session) &&
    !session.user.partnerAccess &&
    voluntaryDowngradeCheck(billing.state).ok
      ? { paidUntilLabel: kind === "paid" && billing.state.paidUntil ? formatMskDay(billing.state.paidUntil) : null }
      : null;
  // Условие бесплатного тарифа — одной строкой под названием плана.
  const planNote =
    kind === "free" || kind === "needs_decision" || (kind === "legacy" && isFreePlan(plan))
      ? t("freeNote", { employees: FREE_MAX_USERS, journals: FREE_MAX_JOURNALS })
      : null;

  // Цены тарифов (ROOT → «Тарифы») и акция (ROOT → «Акции») — те же, что
  // на лендинге и в заказе.
  const [pricing, promotion, ppkFromRub] = await Promise.all([
    billing ? Promise.resolve(billing.pricing) : readPlanPricing(),
    readActivePromotion(now).catch(() => null),
    readPpkIndividualPrice(),
  ]);
  const storage: StorageSummary | null =
    billing && !billing.unit.exempt
      ? await loadStorageSummary({ unit: billing.unit, settings: billing.settings, state: billing.state }).catch((error) => {
          console.error("[billing] storage summary failed", error);
          return null;
        })
      : null;

  // Текущая оплаченная подписка — для расчёта доплаты за остаток.
  const current: CurrentSubscription | null =
    state?.kind === "paid" && state.paidTier
      ? { paidUntil: state.paidUntil, tier: state.paidTier, cycle: state.planCycle, points: state.planPoints }
      : null;
  const pointsInUse = Math.max(1, state?.pointsInUse ?? 1);
  const scheduled = billing?.unit.scheduledPlan ?? null;
  // Варианты оплаты сейчас (карта и счёт): тариф × период при текущих
  // точках; понижение сейчас не оплачивается — оно с конца срока.
  const optionPoints = Math.max(pointsInUse, current && current.tier !== "legacy" ? current.points : 1);
  const options = (["standard", "premium"] as const)
    .flatMap((tier) => (["year", "month"] as const).map((cycle) => ({ tier, cycle, points: optionPoints })))
    .filter((target) => pricing.available[target.tier][target.cycle])
    .map((target) => ({
      target,
      change: quotePlanChange({ rates: pricing.rates, legacyMonthlyRub: pricing.legacyMonthlyRub, current, target, now }),
    }))
    .filter((option) => option.change.kind !== "scheduled");
  // По умолчанию — продление текущего тарифа, иначе запланированный, иначе
  // «Стандарт» за год.
  const sameTarget = (a: PlanTarget, b: PlanTarget | null) =>
    Boolean(b) && a.tier === b!.tier && a.cycle === b!.cycle && a.points === b!.points;
  const defaultOption =
    options.find((option) => option.change.kind === "renew") ??
    options.find((option) => sameTarget(option.target, scheduled ? { ...scheduled, points: Math.max(scheduled.points, pointsInUse) } : null)) ??
    options.find((option) => option.target.tier === "standard" && option.target.cycle === "year") ??
    options[0] ??
    null;
  const defaultOffer = defaultOption ? applyPromotion(defaultOption.change.amountRub, promotion) : null;

  // Промокод: `?promo=` (из ссылки /promo/CODE или поля ниже), иначе код
  // из cookie ссылки. Пустой `?promo=` — явно без кода. Скидку (код или
  // скидка навсегда аккаунта — выгоднейшая) считает сервер, как при оплате.
  const params = await searchParams;
  const promoParam = Array.isArray(params.promo) ? params.promo[0] : params.promo;
  const cookieCode = promoParam === undefined ? ((await cookies()).get(PROMO_COOKIE)?.value ?? null) : null;
  const promoRaw = (promoParam ?? cookieCode ?? "").trim() || null;
  const codeSource = promoParam ? "query" : cookieCode ? "cookie" : null;
  const discount =
    inMobileApp || isDemo || !defaultOffer
      ? null
      : await resolveCheckoutDiscount({
          promoRaw,
          organizationId: orgId,
          email: session.user.email ?? null,
          offerRub: defaultOffer.priceRub,
          now,
          scope: `page:/settings/subscription${codeSource ? ` (code from ${codeSource})` : ""}`,
        }).catch((error) => {
          console.error("[promo] subscription page discount failed", error);
          return null;
        });
  // Код не подошёл — скидка навсегда аккаунта всё равно действует.
  const lifetime = discount?.lifetime ?? null;
  const appliedDiscount: AppliedDiscount | null = discount?.ok
    ? discount.applied
    : lifetime && defaultOffer
      ? {
          source: "lifetime",
          code: lifetime.code,
          kind: lifetime.kind,
          value: lifetime.value,
          lifetime: true,
          discountRub: discountForPrice(lifetime, defaultOffer.priceRub),
          lifetimeDiscountId: lifetime.id,
          expiresAt: lifetime.expiresAt ?? null,
        }
      : null;
  // Код из cookie, который не подошёл, не показываем ошибкой: человек его
  // сейчас не вводил. Код из адреса — показываем причину. Код из cookie,
  // уже закреплённый скидкой навсегда, — остаток ссылки: как без кода.
  const cookieAlreadyBound =
    codeSource === "cookie" && discount?.ok === true && lifetime?.code === discount.typedCode;
  const acceptedCode = discount?.ok && !cookieAlreadyBound ? discount.typedCode : null;
  const promoError = discount && !discount.ok && codeSource !== "cookie" ? discount.message : null;
  const orderHref = (target: PlanTarget, extra: Record<string, string> = {}) => {
    const query = new URLSearchParams({ plan: target.tier, cycle: target.cycle, points: String(target.points), ...extra });
    if (acceptedCode) query.set("promo", acceptedCode);
    return `/order?${query.toString()}`;
  };
  const payHref = defaultOption ? orderHref(defaultOption.target) : "/settings/subscription#tariffs";

  // Автопродление: следующее списание — продление текущего тарифа (или
  // запланированного) со скидкой навсегда, без акции (к тому дню она может
  // закончиться). Срочная скидка, которая к дню списания истечёт, не входит.
  const nextChargeAt = state?.paidUntil ?? null;
  const renewTarget: PlanTarget | null = scheduled
    ? { tier: scheduled.tier, cycle: scheduled.cycle, points: scheduled.points }
    : current && current.tier !== "legacy"
      ? { tier: current.tier, cycle: current.cycle, points: current.points }
      : null;
  // Прежняя «Подписка» продлевается по своей цене за 30 дней.
  const renewRub = renewTarget
    ? planPeriodPriceRub(pricing.rates, renewTarget.tier, renewTarget.cycle, renewTarget.points)
    : pricing.legacyMonthlyRub;
  const lifetimeAtNextCharge =
    lifetime && !(lifetime.expiresAt && nextChargeAt && new Date(lifetime.expiresAt) <= nextChargeAt) ? lifetime : null;
  const recurringRub = lifetimeAtNextCharge ? renewRub - discountForPrice(lifetimeAtNextCharge, renewRub) : renewRub;

  const discountFirst = codeSource === "query" || Boolean(lifetime);
  const discountCard =
    isDemo || !defaultOption || !defaultOffer ? null : (
      <SubscriptionDiscountCard
        offer={defaultOffer}
        planLabel={planLine(defaultOption.target)}
        lifetime={lifetime}
        applied={appliedDiscount}
        typedCode={codeSource === "cookie" && !acceptedCode ? null : promoRaw}
        error={promoError}
        notice={discount?.ok && !cookieAlreadyBound ? discount.notice : null}
        personalPending={discount?.ok ? discount.personalPending : false}
        payHref={payHref}
      />
    );
  const invoiceOptions: InvoiceOption[] = options.map((option) => ({
    key: `${option.target.tier}_${option.target.cycle}_${option.target.points}`,
    label: planLine(option.target),
    tier: option.target.tier,
    cycle: option.target.cycle,
    points: option.target.points,
    amountRub: option.change.amountRub,
  }));

  // История платежей организации. Только проведённые идут в итог: заказ
  // в статусе pending денег не принёс, и складывать его в «оплачено»
  // значит показывать выручку, которой нет.
  const payments = await db.paymentOrder.findMany({
    where: { organizationId: orgId },
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
  // Счёт на пополнение баланса — не счёт на тариф: он живёт в «Баланс и
  // бонусы», здесь карточку тарифа не подменяет.
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
      state?.paidUntil ?? (isFreePlan(plan) ? null : (org?.subscriptionEnd ?? null));
    return (
      <InAppSubscriptionStatus
        decisionCopy={decisionCopy}
        planLabel={shownPlanLabel}
        planNote={planNote}
        paused={plan === "paused"}
        activeUntil={activeUntil}
        expired={activeUntil !== null && activeUntil.getTime() < now.getTime()}
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

  const exempt = !billing || billing.unit.exempt;
  const cabinetStatus: "trial" | "free" | "paid" = kind === "paid" ? "paid" : kind === "free_period" ? "trial" : "free";
  const statusNote =
    kind === "free_period" && state
      ? t("trialNote", { days: state.trialDaysLeft ?? TRIAL_DAYS, employees: FREE_MAX_USERS, journals: FREE_MAX_JOURNALS })
      : kind === "paid" && paidTier && paidTier !== "legacy" && state
        ? [cycleLabel(state.planCycle), t("pointsCount", { count: state.planPoints })].join(" · ")
        : kind === "paid"
          ? t("legacyNote")
          : planNote;
  const usage = state
    ? [
        {
          key: "employees",
          icon: Users,
          label: t("usageEmployees"),
          value: state.seatLimit !== null ? t("usageOf", { used: employees, limit: state.seatLimit }) : t("usageNoLimit", { used: employees }),
        },
        {
          key: "points",
          icon: MapPin,
          label: t("usagePoints"),
          value:
            state.entitlements.pointLimit !== null
              ? t("usageOf", { used: state.pointsInUse, limit: state.entitlements.pointLimit })
              : t("usageNoLimit", { used: state.pointsInUse }),
        },
        {
          key: "journals",
          icon: Layers,
          label: t("usageJournals"),
          value:
            state.entitlements.journalLimit !== null
              ? t("usageOf", { used: state.enabledJournals, limit: state.entitlements.journalLimit })
              : t("usageNoLimit", { used: state.enabledJournals }),
        },
        {
          key: "storage",
          icon: HardDrive,
          label: t("usageStorage"),
          value:
            storage === null
              ? "—"
              : storage.limitBytes === null
                ? t("usageNoLimitText", { used: formatBytes(storage.usedBytes) })
                : storage.limitBytes === 0
                  ? t("storageClosed")
                  : t("usageOfText", { used: formatBytes(storage.usedBytes), limit: formatBytes(storage.limitBytes) }),
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
        {t("title")}
      </h1>

      {isDemo ? (
        <div className="flex items-start gap-3 rounded-2xl border border-[#dcdfed] bg-[#f5f6ff] px-4 py-3 text-[13.5px] leading-[1.5] text-[#3848c7]">
          <FlaskConical className="mt-0.5 size-4 shrink-0" />
          <span>
            {t("demoNote")}
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
            {t.rich("balanceNote", {
              amount: (org?.balanceRub ?? 0).toLocaleString(locale),
              b: (chunks) => <strong className="tabular-nums">{chunks}</strong>,
            })}
          </span>
        </Link>
      ) : null}

      {decisionCopy ? (
        <BillingTransitionGate
          display="card"
          copy={decisionCopy}
          payHref="#tariffs"
          blocking={false}
          cardNote={
            invoiceReady && !isDemo
              ? t("invoiceCardNote")
              : null
          }
        />
      ) : null}
      {decisionReadOnly ? (
        <p className="rounded-2xl border border-[#ffd9a8] bg-[#fffaf0] px-4 py-3 text-[13.5px] leading-[1.5] text-[#7a4a00]">
          {t("decisionReadOnly")}
        </p>
      ) : null}

      {plan === "paused" ? <ResumePausedCard /> : null}

      {/* Ваш тариф: что действует, до какого числа и сколько занято. */}
      <section
        data-testid="subscription-status"
        className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7"
      >
        <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{t("statusTitle")}</div>
        <div className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">{shownPlanLabel}</div>
        {statusNote ? <p className="mt-1.5 max-w-[720px] text-[13.5px] leading-[1.55] text-[#6f7282]">{statusNote}</p> : null}
        {usage.length > 0 && !exempt ? (
          <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {usage.map((item) => (
              <div key={item.key} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
                <dt className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.06em] text-[#6f7282]">
                  <item.icon className="size-3.5" />
                  {item.label}
                </dt>
                <dd className="mt-1 text-[16px] font-semibold tabular-nums text-[#0b1024]">{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {scheduled ? (
          <div
            data-testid="subscription-scheduled"
            className="mt-4 flex flex-col gap-3 rounded-2xl border border-[#c7ccea] bg-[#f5f6ff] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="text-[13.5px] leading-[1.5] text-[#3848c7]">
              {t("scheduledNote", { date: formatMskDay(new Date(scheduled.at)), plan: planLine(scheduled) })}
            </span>
            {!isImpersonating(session) && !session.user.partnerAccess ? <CancelScheduleButton /> : null}
          </div>
        ) : null}
        {testModeActive ? <p className="mt-3 text-[12.5px] text-[#6f7282]">{t("testModeNote")}</p> : null}
      </section>

      {/* Пришли по ссылке с промокодом или уже есть скидка навсегда —
          карточка скидки первой: ради неё человек и открыл страницу. */}
      {discountFirst ? discountCard : null}

      {exempt ? null : (
        <section id="tariffs" className="scroll-mt-24 space-y-3">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {cabinetStatus === "paid" ? t("tariffsChange") : t("tariffsChoose")}
          </h2>
          <CabinetTariffs
            rates={pricing.rates}
            available={pricing.available}
            promotion={promotion}
            ppkFromRub={ppkFromRub}
            ppkHref="/settings/services?order=ppk-development"
            promoCode={acceptedCode}
            cabinet={{
              status: cabinetStatus,
              current:
                current && current.paidUntil
                  ? { paidUntil: current.paidUntil.toISOString(), tier: current.tier, cycle: current.cycle, points: current.points }
                  : null,
              trialUntilLabel: state?.trialEndsAt ? formatMskDay(lastDayBefore(state.trialEndsAt)) : null,
              trialDaysLeft: state?.trialDaysLeft ?? null,
              pointsInUse,
              scheduled: scheduled
                ? {
                    tier: scheduled.tier,
                    cycle: scheduled.cycle,
                    points: scheduled.points,
                    atLabel: formatMskDay(new Date(scheduled.at)),
                  }
                : null,
              legacyMonthlyRub: pricing.legacyMonthlyRub,
              nowIso: now.toISOString(),
            }}
            freeAction={
              voluntaryFree ? <VoluntaryFreeButton paidUntilLabel={voluntaryFree.paidUntilLabel} className="w-full" /> : null
            }
            showTable
          />
        </section>
      )}

      {/* Доставка подключённого оборудования — «Премиум» и пробный; в
          «Стандарте» и на бесплатном — замок со ссылкой на тарифы. */}
      {exempt || isDemo ? null : (
        <EquipmentDeliveryCard
          available={hasFeature(state, "equipmentDelivery")}
          defaultName={session.user.name ?? ""}
          defaultPhone={org?.phone ?? ""}
          defaultAddress={org?.address ?? ""}
        />
      )}

      {discountFirst ? null : discountCard}

      {!isDemo && invoiceOptions.length > 0 ? (
        <InvoiceCard
          ready={invoiceReady}
          orgName={org?.name ?? t("orgNameFallback")}
          orgInn={org?.inn ?? null}
          options={invoiceOptions}
          defaultKey={
            defaultOption
              ? `${defaultOption.target.tier}_${defaultOption.target.cycle}_${defaultOption.target.points}`
              : invoiceOptions[0].key
          }
          promotion={promotion}
          discount={appliedDiscount}
          promoCode={acceptedCode}
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

      {/* Отключить автопродление можно всегда (оферта) — карточка есть и у
          прежней «Подписки», пока автопродление включено. */}
      {(kind === "paid" && renewTarget) || org?.recurringActive === true ? (
        <RecurringCard
          active={org?.recurringActive === true}
          nextChargeAt={nextChargeAt?.toISOString() ?? null}
          monthlyRub={recurringRub}
          enableHref={
            current && current.tier !== "legacy" && !scheduled
              ? orderHref({ tier: current.tier, cycle: current.cycle, points: current.points }, { recurring: "1" })
              : "#tariffs"
          }
        />
      ) : null}

      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="text-[16px] font-semibold text-[#0b1024]">
            {t("paymentHistory")}
          </span>
          {paidTotalRub > 0 ? (
            <span className="text-[13.5px] text-[#6f7282]">
              {t.rich("paidTotal", {
                amount: paidTotalRub.toLocaleString(locale),
                b: (chunks) => (
                  <span className="font-semibold tabular-nums text-[#0b1024]">{chunks}</span>
                ),
              })}
            </span>
          ) : null}
        </div>

        {documentsReady && !org?.inn && payments.some(closingEligible) ? (
          <p className="mt-3 rounded-2xl bg-[#fff8eb] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#b25f00]">
            {t.rich("closingInnNote", {
              link: (chunks) => (
                <Link href="/settings/organization" className="underline underline-offset-2">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        ) : null}

        {payments.length === 0 ? (
          <p className="mt-4 text-[13.5px] text-[#9b9fb3]">
            {t("noPayments")}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-[#9b9fb3]">
                  <th className="pb-2 font-medium">{t("colDateTime")}</th>
                  <th className="pb-2 font-medium">{t("colPurpose")}</th>
                  <th className="pb-2 font-medium">{t("colStatus")}</th>
                  <th className="pb-2 text-right font-medium">{t("colAmount")}</th>
                  <th className="pb-2 pl-4 font-medium">{t("colDocuments")}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-t border-[#f2f3f8]">
                    <td className="py-2.5 text-[#0b1024]">
                      {(payment.paidAt ?? payment.createdAt).toLocaleString(locale)}
                    </td>
                    <td className="py-2.5 text-[#6f7282]">
                      {payment.description}
                      {/* Тестовый платёж помечаем и не считаем в итог —
                          иначе «оплачено» покажет деньги, которых не было. */}
                      {payment.isTest ? (
                        <span className="ml-2 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] text-[#6f7282]">
                          {t("testBadge")}
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
                      {Number(payment.amountRub).toLocaleString(locale)} ₽
                      {payment.pointsSpent > 0 ? (
                        <div className="text-[12px] text-[#3848c7]">
                          {t("pointsSpent", { points: payment.pointsSpent.toLocaleString(locale) })}
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
                            {t("invoicePdf")}
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

      {/* Как считается стоимость: точки и переходы между тарифами. */}
      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <Coins className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
              {t("howCalculated")}
            </h2>
            <ul className="mt-2 max-w-[720px] list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-[#3c4053]">
              <li>{t("rulePoints", { seats: SEATS_PER_POINT, from: POINTS_DISCOUNT_FROM, percent: POINTS_DISCOUNT_PERCENT })}</li>
              <li>{t("ruleUpgrade")}</li>
              <li>{t("ruleSwitch")}</li>
              <li>{t("ruleDowngrade")}</li>
              <li>{t("ruleTrial", { trialDays: TRIAL_DAYS })}</li>
            </ul>

            <div className="mt-5 overflow-x-auto rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
              <div className="text-[13px] font-semibold text-[#0b1024]">{t("examplesTitle")}</div>
              <table className="mt-2 w-full min-w-[360px] text-[13.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-[#9b9fb3]">
                    <th className="pb-2 font-medium">{t("colPoints")}</th>
                    <th className="pb-2 font-medium">{tierName("standard")}</th>
                    <th className="pb-2 font-medium">{tierName("premium")}</th>
                  </tr>
                </thead>
                <tbody>
                  {EXAMPLE_POINTS.map((points) => (
                    <tr key={points} className="border-t border-[#ececf4]">
                      <td className="py-2 text-[#3c4053]">
                        {t("pointsCount", { count: points })}
                        {points >= POINTS_DISCOUNT_FROM ? (
                          <span className="ml-1.5 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[11px] font-medium text-[#116b2a]">
                            −{POINTS_DISCOUNT_PERCENT} %
                          </span>
                        ) : null}
                      </td>
                      {(["standard", "premium"] as const).map((tier) => (
                        <td key={tier} className="py-2 tabular-nums text-[#0b1024]">
                          {planMonthlyRub(pricing.rates, tier, "year", points).toLocaleString(locale)} ₽{t("perMonthSuffix")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {promotion ? (
                <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[#3c4053]">
                  <span>{t("promoNow", { title: promotion.title })}</span>
                  <PromoBadge promotion={promotion} />
                  <span>{t("promoScope")}</span>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
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
  const t = useTranslations("settingsUi.subscriptionPage");
  const locale = useLocale();
  return (
    <div className="space-y-5">
      <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
        {t("appTitle")}
      </h1>

      {decisionCopy ? (
        <BillingTransitionGate display="card" copy={decisionCopy} payHref={null} blocking={false} />
      ) : null}

      {paused ? <ResumePausedCard /> : null}

      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
        <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          {t("companyPlan")}
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
            {t("expiredNotice")}
          </p>
        ) : null}

        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          <StatusCell
            label={expired ? t("expiredLabel") : t("validUntilLabel")}
            value={activeUntil ? activeUntil.toLocaleDateString(locale) : t("noExpiry")}
          />
          <StatusCell label={t("employeesLabel")} value={String(employees)} />
          <StatusCell label={t("pointsBalance")} value={`${balanceRub.toLocaleString(locale)} ₽`} />
        </dl>
      </section>

      {payments.length > 0 ? (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("paymentHistory")}</h2>
          <ul className="mt-3 divide-y divide-[#f2f3f8]">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-[14px] text-[#0b1024]">{payment.description}</div>
                  <div className="mt-0.5 text-[12.5px] text-[#6f7282]">
                    {payment.at.toLocaleDateString(locale)} · {payment.status}
                  </div>
                </div>
                <div
                  className={`shrink-0 text-[14px] tabular-nums ${payment.paid ? "text-[#0b1024]" : "text-[#6f7282]"}`}
                >
                  {payment.amountRub.toLocaleString(locale)} ₽
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

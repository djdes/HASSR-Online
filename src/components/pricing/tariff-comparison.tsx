"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Building2, Check, Crown, FileText, Gift, Minus, Plus, Sparkles, Users } from "lucide-react";

import { PromoPrice } from "@/components/pricing/promo-price";
import { formatNumber, type Locale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/site-locale";
import { CARD_POINTS, COMPARISON_GROUPS, type ComparisonCell } from "@/lib/plan-catalog";
import { applyPromotion, type AppliedPromotion } from "@/lib/promo/promotions";
import {
  MAX_POINTS,
  POINTS_DISCOUNT_FROM,
  POINTS_DISCOUNT_PERCENT,
  TRIAL_DAYS,
  hasPointsDiscount,
  maxYearlySavingsPercent,
  planMonthlyRub,
  planPeriodFullRub,
  planPeriodPriceRub,
  planTariffKey,
  quotePlanChange,
  yearlySavingsRub,
  type BillingCycle,
  type CurrentSubscription,
  type PaidTier,
  type PlanChangeQuote,
  type PlanRates,
  type TierId,
} from "@/lib/tariff-plans";
import { cn } from "@/lib/utils";

/**
 * Витрина тарифов 2026-10 — одна на лендинг, /pricing и кабинет: три
 * колонки, как у подписок на ИИ-модели (переключатель «Помесячно / За год»
 * с выгодой, «Популярный» посередине, накопительный список «Всё из …,
 * плюс:»), выбор числа точек и таблица сравнения под колонками.
 *
 * Цены приходят с сервера (`PlatformTariff`, правит ROOT) и акция — тоже;
 * компонент только считает тот же прайс (`tariff-plans.ts`), что и сервер
 * при оформлении. В кабинете кнопки показывают вид перехода от текущей
 * подписки (`quotePlanChange` от серверного «сейчас», чтобы разметка
 * совпала при гидрации): новая, продление, доплата за остаток, переход на
 * год с зачётом, понижение — с конца срока.
 */

export type TariffCabinetState = {
  /** Что сейчас: пробный, бесплатный, оплаченный тариф или прежняя «Подписка». */
  status: "trial" | "free" | "paid";
  /** Оплаченная подписка — для расчёта доплаты. */
  current: { paidUntil: string; tier: PaidTier | "legacy"; cycle: BillingCycle; points: number } | null;
  /** «по 8 ноября» — для подписи пробного периода. */
  trialUntilLabel: string | null;
  trialDaysLeft: number | null;
  /** Точек в работе: меньше выбрать нельзя. */
  pointsInUse: number;
  /** Запланированное понижение. */
  scheduled: { tier: PaidTier; cycle: BillingCycle; points: number; atLabel: string } | null;
  /** Цена прежней «Подписки» за 30 дней — для зачёта остатка. */
  legacyMonthlyRub: number;
  /** Серверное «сейчас» (ISO) — одинаковые суммы на сервере и в браузере. */
  nowIso: string;
};

type Props = {
  mode: "public" | "cabinet";
  rates: PlanRates;
  available: Record<PaidTier, Record<BillingCycle, boolean>>;
  promotion: AppliedPromotion | null;
  /** «Заказать индивидуально» в блоке ППК — цена «от». */
  ppkFromRub: number;
  /** Куда ведёт заказ ППК: страница услуг (кабинет) или /uslugi. */
  ppkHref: string;
  /** Кнопка «Начать бесплатно» (лендинг — якорь формы, /pricing — регистрация). */
  startHref?: string;
  /** Промокод из ссылки — уезжает в заказ. */
  promoCode?: string | null;
  cabinet?: TariffCabinetState;
  /** «Перейти на бесплатный» — кнопка под карточкой бесплатного (кабинет). */
  freeAction?: ReactNode;
  /** Запланировать / отменить понижение (кабинет). */
  onSchedule?: (target: { tier: PaidTier; cycle: BillingCycle; points: number }) => void;
  onCancelSchedule?: () => void;
  scheduleBusy?: boolean;
  /** Таблица сравнения под колонками. */
  showTable?: boolean;
  className?: string;
};

const TIER_ICON: Record<TierId, typeof Gift> = { free: Gift, standard: Users, premium: Crown };

export function TariffComparison({
  mode,
  rates,
  available,
  promotion,
  ppkFromRub,
  ppkHref,
  startHref = "/register",
  promoCode = null,
  cabinet,
  freeAction = null,
  onSchedule,
  onCancelSchedule,
  scheduleBusy = false,
  showTable = true,
  className,
}: Props) {
  const t = useTranslations("landingComponents.tariffs");
  const locale = useLocale() as Locale;
  const currentPaid = cabinet?.current ?? null;
  const [cycle, setCycle] = useState<BillingCycle>(currentPaid?.cycle ?? "year");
  const minPoints = Math.max(1, cabinet?.pointsInUse ?? 1);
  const [points, setPoints] = useState(Math.max(minPoints, currentPaid?.points ?? 1));
  // Неразрывный пробел перед «₽»: сумма в кнопке и в цене не разрывается.
  const rub = (value: number) => `${formatNumber(locale, value)}\u00a0₽`;
  const href = (path: string) => (mode === "public" ? localizedHref(path, locale) : path);
  const savings = maxYearlySavingsPercent(rates);

  const quotes = useMemo(() => {
    if (!cabinet) return null;
    const now = new Date(cabinet.nowIso);
    const current: CurrentSubscription | null = currentPaid
      ? { paidUntil: new Date(currentPaid.paidUntil), tier: currentPaid.tier, cycle: currentPaid.cycle, points: currentPaid.points }
      : null;
    const quote = (tier: PaidTier): PlanChangeQuote =>
      quotePlanChange({ rates, legacyMonthlyRub: cabinet.legacyMonthlyRub, current, target: { tier, cycle, points }, now });
    return { standard: quote("standard"), premium: quote("premium") };
  }, [cabinet, currentPaid, rates, cycle, points]);

  const orderHref = (tier: PaidTier) => {
    const params = new URLSearchParams({ plan: tier, cycle, points: String(points) });
    if (promoCode) params.set("promo", promoCode);
    return `/order?${params.toString()}`;
  };

  const intro = (tier: TierId) =>
    tier === "free" ? t("includes.free") : tier === "standard" ? t("includes.standard") : t("includes.premium");

  return (
    <div className={cn("space-y-6", className)} data-testid="tariff-comparison">
      {/* Переключатель периода и число точек — над колонками, как у ИИ-подписок. */}
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <div role="radiogroup" aria-label={t("toggle.label")} className="inline-flex rounded-2xl border border-[#dcdfed] bg-[#f5f6ff] p-1">
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={cycle === value}
              data-testid={`tariff-cycle-${value}`}
              onClick={() => setCycle(value)}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[14px] font-medium transition-colors",
                cycle === value ? "bg-white text-[#0b1024] shadow-[0_1px_3px_rgba(11,16,36,0.12)]" : "text-[#6f7282] hover:text-[#0b1024]",
              )}
            >
              {value === "month" ? t("toggle.month") : t("toggle.year")}
              {value === "year" && savings > 0 ? (
                <span className="rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[12px] font-semibold text-[#116b2a]">
                  {t("toggle.save", { percent: savings })}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex flex-col items-center gap-1 sm:items-end">
          <div className="inline-flex items-center gap-3">
            <span className="text-[14px] font-medium text-[#3c4053]">{t("pointsPicker.label")}</span>
            <div className="inline-flex items-center rounded-2xl border border-[#dcdfed] bg-white">
              <button
                type="button"
                aria-label={t("pointsPicker.decrease")}
                data-testid="tariff-points-dec"
                disabled={points <= minPoints}
                onClick={() => setPoints((n) => Math.max(minPoints, n - 1))}
                className="flex size-10 items-center justify-center rounded-l-2xl text-[#3c4053] transition-colors hover:bg-[#f5f6ff] disabled:opacity-40"
              >
                <Minus className="size-4" />
              </button>
              <span data-testid="tariff-points" className="min-w-[2.5rem] text-center text-[16px] font-semibold tabular-nums text-[#0b1024]">
                {points}
              </span>
              <button
                type="button"
                aria-label={t("pointsPicker.increase")}
                data-testid="tariff-points-inc"
                disabled={points >= MAX_POINTS}
                onClick={() => setPoints((n) => Math.min(MAX_POINTS, n + 1))}
                className="flex size-10 items-center justify-center rounded-r-2xl text-[#3c4053] transition-colors hover:bg-[#f5f6ff] disabled:opacity-40"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>
          <span className="max-w-[360px] text-center text-[12.5px] leading-snug text-[#6f7282] sm:text-right">
            {t("pointsPicker.hint", { from: POINTS_DISCOUNT_FROM, percent: POINTS_DISCOUNT_PERCENT })}
          </span>
        </div>
      </div>

      <div className="grid items-stretch gap-5 lg:grid-cols-3">
        {/* Бесплатный */}
        <TierCard
          tier="free"
          name={t("tiers.free.name")}
          tagline={t("tiers.free.tagline", { trialDays: TRIAL_DAYS })}
          badge={
            cabinet?.status === "trial"
              ? t("badges.trial", { days: cabinet.trialDaysLeft ?? TRIAL_DAYS })
              : cabinet?.status === "free"
                ? t("badges.current")
                : null
          }
          price={
            <div className="space-y-1.5">
              <div className="whitespace-nowrap text-[34px] font-semibold leading-none tracking-[-0.02em] text-[#0b1024]">{rub(0)}</div>
              <div className="text-[13px] leading-snug text-[#6f7282]">{t("price.freeNote", { trialDays: TRIAL_DAYS })}</div>
            </div>
          }
          intro={intro("free")}
          points={CARD_POINTS.free.map((p) => t(`features.${p.key}` as never, (p.values ?? {}) as never))}
          action={
            mode === "public" ? (
              <CtaLink href={href(startHref)} variant="outline" testId="tariff-cta-free">
                {t("cta.startFree")}
              </CtaLink>
            ) : cabinet?.status === "paid" ? (
              freeAction
            ) : (
              <CtaStatic>{cabinet?.status === "trial" ? t("cta.trialNow") : t("cta.current")}</CtaStatic>
            )
          }
        />

        {(["standard", "premium"] as const).map((tier) => {
          const monthlyList = planMonthlyRub(rates, tier, cycle, points);
          const periodRub = planPeriodPriceRub(rates, tier, cycle, points);
          const fullRub = planPeriodFullRub(rates, tier, cycle, points);
          const price = applyPromotion(monthlyList, promotion);
          const isAvailable = available[tier][cycle];
          const quote = quotes?.[tier] ?? null;
          const isCurrent =
            cabinet?.status === "paid" &&
            currentPaid?.tier === tier &&
            currentPaid.cycle === cycle &&
            currentPaid.points === points;
          const scheduledHere =
            cabinet?.scheduled &&
            cabinet.scheduled.tier === tier &&
            cabinet.scheduled.cycle === cycle &&
            cabinet.scheduled.points === points
              ? cabinet.scheduled
              : null;
          return (
            <TierCard
              key={tier}
              tier={tier}
              highlighted={tier === "standard"}
              name={tier === "standard" ? t("tiers.standard.name") : t("tiers.premium.name")}
              tagline={tier === "standard" ? t("tiers.standard.tagline") : t("tiers.premium.tagline")}
              badge={isCurrent ? t("badges.current") : tier === "standard" ? t("badges.popular") : null}
              price={
                <div className="space-y-1.5">
                  <PromoPrice
                    locale={locale}
                    price={price}
                    size="xl"
                    layout="stacked"
                    tone={tier === "standard" ? "dark" : "light"}
                    suffix={
                      <span className={cn("ml-1 text-[14px]", tier === "standard" ? "text-white/60" : "text-[#9b9fb3]")}>
                        {t("price.perMonth")}
                      </span>
                    }
                  />
                  <div
                    data-testid={`tariff-period-${tier}`}
                    className={cn("text-[13px] leading-snug", tier === "standard" ? "text-white/70" : "text-[#6f7282]")}
                  >
                    {cycle === "year"
                      ? t("price.yearTotal", { amount: rub(periodRub) })
                      : t("price.monthly")}
                    {cycle === "year" && yearlySavingsRub(rates, tier, points) > 0
                      ? ` · ${t("price.yearSavings", { amount: rub(yearlySavingsRub(rates, tier, points)) })}`
                      : ""}
                    {points > 1 ? ` · ${t("price.forPoints", { count: points })}` : ""}
                    {hasPointsDiscount(points) && fullRub > periodRub
                      ? ` · ${t("price.pointsDiscount", { percent: POINTS_DISCOUNT_PERCENT })}`
                      : ""}
                  </div>
                </div>
              }
              intro={intro(tier)}
              points={CARD_POINTS[tier].map((p) => t(`features.${p.key}` as never, (p.values ?? {}) as never))}
              note={quote ? changeNote(quote, t, rub) : null}
              action={
                !isAvailable ? (
                  <CtaStatic>{t("cta.unavailable")}</CtaStatic>
                ) : mode === "public" || !quote ? (
                  <CtaLink
                    href={href(orderHref(tier))}
                    variant={tier === "standard" ? "light" : "primary"}
                    testId={`tariff-cta-${tier}`}
                  >
                    {t("cta.choose", { name: tier === "standard" ? t("tiers.standard.name") : t("tiers.premium.name") })}
                  </CtaLink>
                ) : quote.kind === "scheduled" ? (
                  scheduledHere ? (
                    <div className="space-y-2">
                      <CtaStatic>{t("cta.scheduledDone", { date: scheduledHere.atLabel })}</CtaStatic>
                      {onCancelSchedule ? (
                        <button
                          type="button"
                          onClick={onCancelSchedule}
                          disabled={scheduleBusy}
                          className={cn(
                            "w-full text-center text-[13px] font-medium underline underline-offset-2 disabled:opacity-60",
                            tier === "standard" ? "text-white/80" : "text-[#3848c7]",
                          )}
                        >
                          {t("cta.cancelSchedule")}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid={`tariff-cta-${tier}`}
                      disabled={scheduleBusy || !onSchedule}
                      onClick={() => onSchedule?.({ tier, cycle, points })}
                      className={ctaClass("outline")}
                    >
                      {t("cta.scheduled", { date: shortDate(quote.periodStart, locale) })}
                    </button>
                  )
                ) : (
                  <CtaLink
                    href={orderHref(tier)}
                    variant={tier === "standard" ? "light" : "primary"}
                    testId={`tariff-cta-${tier}`}
                  >
                    {quote.kind === "renew"
                      ? t("cta.renew", { amount: rub(quote.amountRub) })
                      : quote.kind === "upgrade"
                        ? t("cta.upgrade", { amount: rub(quote.amountRub) })
                        : quote.kind === "switch"
                          ? t("cta.switch", { amount: rub(quote.amountRub) })
                          : t("cta.newPlan", { amount: rub(quote.amountRub) })}
                  </CtaLink>
                )
              }
              data-tariff-key={planTariffKey(tier, cycle)}
            />
          );
        })}
      </div>

      <p className="text-center text-[13px] leading-relaxed text-[#6f7282]">
        {t("note.trial", { trialDays: TRIAL_DAYS })} {t("note.switch")}
      </p>

      {/* ППК индивидуально — у всех тарифов (владелец: «во все тарифы … кнопку
          заказать индивидуально от 10 000»). */}
      <div
        data-testid="tariff-ppk"
        className="flex flex-col gap-4 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <FileText className="size-5" />
          </span>
          <div>
            <div className="text-[16px] font-semibold text-[#0b1024]">{t("ppk.title")}</div>
            <p className="mt-1 max-w-[560px] text-[14px] leading-[1.55] text-[#6f7282]">{t("ppk.text")}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
          <span className="text-center text-[15px] font-semibold text-[#0b1024] sm:text-right">
            {t("ppk.price", { price: rub(ppkFromRub) })}
          </span>
          <CtaLink href={href(ppkHref)} variant="outline" testId="tariff-ppk-cta">
            {t("ppk.cta")}
          </CtaLink>
        </div>
      </div>

      {showTable ? <ComparisonTable /> : null}
    </div>
  );
}

function changeNote(
  quote: PlanChangeQuote,
  t: ReturnType<typeof useTranslations<"landingComponents.tariffs">>,
  rub: (value: number) => string,
): string | null {
  switch (quote.kind) {
    case "upgrade":
      return t("explain.upgrade", { days: quote.remainingDays, difference: rub(quote.differenceRub) });
    case "switch":
      return quote.creditRub > 0 ? t("explain.switch", { credit: rub(quote.creditRub), price: rub(quote.periodPriceRub) }) : null;
    case "scheduled":
      return t("explain.scheduled");
    default:
      return null;
  }
}

/** «8 нояб.» — короткая дата в кнопке (часовой пояс — Москва). */
function shortDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : locale === "uz" ? "uz-Latn-UZ" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Moscow",
  }).format(date);
}

function TierCard({
  tier,
  name,
  tagline,
  badge,
  price,
  intro,
  points,
  note = null,
  action,
  highlighted = false,
  ...rest
}: {
  tier: TierId;
  name: string;
  tagline: string;
  badge: string | null;
  price: ReactNode;
  intro: string;
  points: string[];
  note?: string | null;
  action: ReactNode;
  highlighted?: boolean;
  "data-tariff-key"?: string;
}) {
  const Icon = TIER_ICON[tier];
  return (
    <div
      data-testid={`tariff-card-${tier}`}
      data-tariff-key={rest["data-tariff-key"]}
      className={
        highlighted
          ? "relative flex h-full flex-col overflow-hidden rounded-3xl bg-[#0b1024] p-5 text-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)] sm:p-7"
          : "relative flex h-full flex-col rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-7"
      }
    >
      {highlighted ? (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -right-16 -top-16 size-[260px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
          <div className="absolute -bottom-10 -left-16 size-[240px] rounded-full bg-[#7a5cff] opacity-30 blur-[120px]" />
        </div>
      ) : null}
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-center gap-3">
          <span
            className={
              highlighted
                ? "flex size-11 items-center justify-center rounded-2xl bg-white/10 text-white ring-1 ring-white/20"
                : "flex size-11 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]"
            }
          >
            <Icon className="size-5" />
          </span>
          <div className="text-[20px] font-semibold tracking-[-0.01em]">{name}</div>
          {badge ? (
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider",
                highlighted ? "bg-[#7cf5c0]/20 text-[#7cf5c0]" : "bg-[#eef1ff] text-[#3848c7]",
              )}
            >
              {tier === "premium" ? <Sparkles className="size-3" /> : null}
              {badge}
            </span>
          ) : null}
        </div>
        <p className={cn("mt-2 text-[14px] leading-[1.5]", highlighted ? "text-white/70" : "text-[#6f7282]")}>{tagline}</p>
        <div className="mt-5">{price}</div>
        <div className="mt-5">{action}</div>
        {note ? (
          <p className={cn("mt-2 text-center text-[12.5px] leading-snug", highlighted ? "text-white/70" : "text-[#6f7282]")}>{note}</p>
        ) : null}
        <div className={cn("mt-6 text-[13px] font-medium", highlighted ? "text-white/60" : "text-[#9b9fb3]")}>{intro}</div>
        <ul className={cn("mt-3 flex-1 space-y-2.5 text-[14px]", highlighted ? "text-white/85" : "text-[#3c4053]")}>
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2">
              <Check className={cn("mt-0.5 size-4 shrink-0", highlighted ? "text-[#7cf5c0]" : "text-[#5566f6]")} />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ctaClass(variant: "primary" | "light" | "outline"): string {
  return cn(
    // min-h, а не h: «Повысить — доплата 1 000 ₽» в узкой колонке кабинета
    // переносится на вторую строку и не должна вылезать за кнопку.
    "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 py-2 text-center text-[15px] font-medium leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-11",
    variant === "primary" &&
      "bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]",
    variant === "light" && "bg-white text-[#0b1024] hover:bg-white/90",
    variant === "outline" && "border border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
  );
}

function CtaLink({
  href,
  variant,
  testId,
  children,
}: {
  href: string;
  variant: "primary" | "light" | "outline";
  testId?: string;
  children: ReactNode;
}) {
  // Обычная ссылка: на /order нужна полная загрузка (скрипт кассы, свежая сумма).
  return (
    <a href={href} data-testid={testId} className={ctaClass(variant)}>
      {children}
      <ArrowRight className="size-4 shrink-0" />
    </a>
  );
}

function CtaStatic({ children }: { children: ReactNode }) {
  return (
    <span
      aria-disabled="true"
      className="inline-flex min-h-12 w-full cursor-default items-center justify-center gap-2 rounded-2xl border border-[#c7ccea] bg-[#eef1ff] px-4 py-2 text-center text-[15px] font-medium leading-tight text-[#3848c7] sm:min-h-11"
    >
      {children}
    </span>
  );
}

/** Таблица сравнения: строки — из `COMPARISON_GROUPS`, подписи — из каталога i18n. */
function ComparisonTable() {
  const t = useTranslations("landingComponents.tariffs");
  const tiers: TierId[] = ["free", "standard", "premium"];
  const cell = (value: ComparisonCell) => {
    if (value.kind === "yes") {
      return (
        <span className="inline-flex items-center justify-center" aria-label={t("table.yes")}>
          <Check className="size-4 text-[#5566f6]" />
        </span>
      );
    }
    if (value.kind === "no") {
      return (
        <span className="text-[#c9ccdb]" aria-label={t("table.no")}>
          —
        </span>
      );
    }
    return <span>{t(`cells.${value.key}` as never, (value.values ?? {}) as never)}</span>;
  };
  return (
    <section data-testid="tariff-table" className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-7">
      <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("table.title")}</h3>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[14px]">
          <thead>
            <tr className="text-left">
              <th className="w-[34%] pb-3 pr-3 text-[12px] font-medium uppercase tracking-[0.12em] text-[#9b9fb3]">{t("table.feature")}</th>
              {tiers.map((tier) => (
                <th key={tier} className="pb-3 pr-3 text-[15px] font-semibold text-[#0b1024]">
                  <span className="inline-flex items-center gap-1.5">
                    {tier === "standard" ? <Building2 className="size-4 text-[#5566f6]" /> : null}
                    {t(`tiers.${tier}.name` as never)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          {COMPARISON_GROUPS.map((group) => (
            <tbody key={group.key}>
              <tr>
                <td colSpan={4} className="pb-2 pt-4 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                  {t(`groups.${group.key}` as never)}
                </td>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.key} className="border-t border-[#f2f3f8] align-top">
                  <td className="py-2.5 pr-3 text-[#3c4053]">{t(`rows.${row.key}` as never)}</td>
                  {tiers.map((tier) => (
                    <td key={tier} className="py-2.5 pr-3 text-[#0b1024]">
                      {cell(row.cells[tier])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

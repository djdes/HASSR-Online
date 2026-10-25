import {
  BILLING_PAY_HREF,
  formatMskDay,
  lastDayBefore,
  mskDayKey,
  shouldShowTrialBanner,
  transitionCopy,
  trialBannerText,
  type AccountBillingState,
  type TransitionCopy,
  type TrialSettings,
} from "@/lib/billing-period";
import { cookies } from "next/headers";

import { BILLING_ANNOUNCEMENT_COOKIE, isAnnouncementDismissed } from "@/lib/billing-announcement-cookie";
import { hasPendingInvoice, loadAccountBilling, type BillingUnit } from "@/lib/billing.server";
import { BILLING_TEST_MODE, planLabel } from "@/lib/plan-limits";
import { hasFullWorkspaceAccess, type RoleAccessActor } from "@/lib/role-access";
import { planMonthlyRub, type PlanRates } from "@/lib/tariff-plans";
import { readPlanPricing, type PlanPricing } from "@/lib/tariffs";

/**
 * Что показать в кабинете про тариф: плашку пробного периода, окно решения
 * руководителю после пробного, плашку сотруднику, строку тарифа в шапке.
 * Считается один раз на запрос в layout'е (сайт и оболочка мини-приложения)
 * и на странице тарифа.
 */
export type BillingView = {
  state: AccountBillingState;
  settings: TrialSettings;
  unit: BillingUnit;
  /** Цены тарифов 2026-10 (за месяц) и что продаётся. */
  pricing: PlanPricing;
  /** «от» — цена за месяц при оплате за год, одна точка. */
  pricesFrom: { standardFromRub: number; premiumFromRub: number };
  /** Плашка пробного периода (та же, что была у анонса «бесплатно для всех»). */
  announcement: {
    lead: string;
    tail: string | null;
    tailParts: null;
    href: string | null;
    dayKey: string;
  } | null;
  /** Окно решения руководителю; null — не показывать. */
  gate: { copy: TransitionCopy; blocking: boolean; payHref: string | null } | null;
  /** Тонкая плашка «Руководитель выбирает тариф». */
  staffNotice: boolean;
  /** Выставлен счёт по безналу и ещё не оплачен — ждём деньги, не давим. */
  pendingInvoice: boolean;
  /** Надписи «тестовый режим, оплата не списывается» — только пока переход выключен. */
  testModeActive: boolean;
  /** Строка тарифа в шапке. */
  header: { plan: string; label: string | null; note: string | null };
};

export function pricesFromRates(rates: PlanRates): { standardFromRub: number; premiumFromRub: number } {
  return { standardFromRub: planMonthlyRub(rates, "standard", "year"), premiumFromRub: planMonthlyRub(rates, "premium", "year") };
}

/** Название оплаченного тарифа: «Премиум», «Стандарт», «Подписка (прежний тариф)». */
function paidLabel(state: AccountBillingState): string {
  if (state.paidTier === "standard") return "Стандарт";
  if (state.paidTier === "premium") return "Премиум";
  return planLabel("paid");
}

export async function loadBillingView(args: {
  organizationId: string;
  user: RoleAccessActor;
  impersonating: boolean;
  partnerAccess: boolean;
  inMobileApp: boolean;
  now?: Date;
}): Promise<BillingView | null> {
  const now = args.now ?? new Date();
  const loaded = await loadAccountBilling(args.organizationId, now);
  if (!loaded) return null;
  const { state, settings, unit } = loaded;
  const fullAccess = hasFullWorkspaceAccess(args.user);
  const canDecide = fullAccess && !args.impersonating && !args.partnerAccess;
  const needsDecision = state.kind === "needs_decision" && !state.inactive;

  const [pricing, pendingInvoice] = await Promise.all([
    readPlanPricing(),
    needsDecision ? hasPendingInvoice(unit.scopeOrgIds, now).catch(() => false) : Promise.resolve(false),
  ]);
  const pricesFrom = pricesFromRates(pricing.rates);

  // Плашку пробного периода видит руководство: сотруднику она ни к чему —
  // выбирать тариф не ему. Закрыта сегодня на этом устройстве (кука) — не
  // рисуем вовсе: иначе плашка появлялась бы после гидрации и сдвигала страницу.
  const showBanner = shouldShowTrialBanner(state) && fullAccess;
  const banner = showBanner ? trialBannerText(state) : null;
  const dismissedToday =
    banner && !banner.urgent
      ? await cookies()
          .then((store) => isAnnouncementDismissed(store.get(BILLING_ANNOUNCEMENT_COOKIE)?.value, mskDayKey(now)))
          .catch(() => false)
      : false;
  const announcement =
    banner && !dismissedToday
      ? {
          lead: banner.lead,
          // В приложении WeSetup про тарифы и оплату не говорим (правила
          // сторов) — только сам пробный период.
          tail: args.inMobileApp ? null : banner.tail,
          tailParts: null,
          href: args.inMobileApp ? null : BILLING_PAY_HREF,
          dayKey: mskDayKey(now),
        }
      : null;

  const gate =
    needsDecision && canDecide
      ? {
          copy: transitionCopy({ state, prices: pricesFrom }),
          // В приложении WeSetup звать к оплате нельзя (правила сторов) —
          // окно без кнопки оплаты и не блокирует. Выставленный счёт —
          // решение уже принято, ждём деньги.
          blocking: !args.inMobileApp && !pendingInvoice,
          payHref: args.inMobileApp ? null : BILLING_PAY_HREF,
        }
      : null;

  const header =
    state.kind === "free_period"
      ? {
          plan: "trial",
          label: "Пробный период",
          note: state.trialEndsAt ? `по ${formatMskDay(lastDayBefore(state.trialEndsAt))}` : null,
        }
      : state.kind === "needs_decision"
        ? { plan: "free", label: "Нужно выбрать тариф", note: null }
        : state.kind === "free"
          ? { plan: "free", label: null, note: null }
          : state.kind === "paid"
            ? {
                plan: state.paidTier ?? "paid",
                label: paidLabel(state),
                note: state.paidUntil ? `до ${formatMskDay(state.paidUntil)}` : null,
              }
            : { plan: unit.plan, label: null, note: null };

  return {
    state,
    settings,
    unit,
    pricing,
    pricesFrom,
    announcement,
    gate,
    staffNotice: needsDecision && !fullAccess,
    pendingInvoice,
    testModeActive: BILLING_TEST_MODE && state.kind === "legacy",
    header,
  };
}

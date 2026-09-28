import {
  BILLING_PAY_HREF,
  announcementText,
  formatMskDay,
  lastFreeDay,
  mskDayKey,
  shouldShowAnnouncement,
  transitionCopy,
  type AccountBillingState,
  type BillingPrice,
  type FreePeriodSettings,
  type TransitionCopy,
} from "@/lib/billing-period";
import { hasPendingInvoice, loadAccountBilling, type BillingUnit } from "@/lib/billing.server";
import { BILLING_TEST_MODE } from "@/lib/plan-limits";
import { getDisplayOffer } from "@/lib/promo/offer";
import { hasFullWorkspaceAccess, type RoleAccessActor } from "@/lib/role-access";
import { fallbackTariffs, readTariffs, TARIFF_MONTHLY, type Tariff } from "@/lib/tariffs";

/**
 * Что показать в кабинете про бесплатный период и переход на оплату:
 * анонс, окно решения руководителю, плашку сотруднику, строку тарифа в
 * шапке. Считается один раз на запрос в layout'е (сайт и оболочка
 * мини-приложения) и на странице тарифа.
 */
export type BillingView = {
  state: AccountBillingState;
  settings: FreePeriodSettings;
  unit: BillingUnit;
  priceRub: number;
  announcement: {
    lead: string;
    tail: string | null;
    tailParts: { before: string; price: BillingPrice; after: string } | null;
    href: string | null;
    dayKey: string;
  } | null;
  /** Окно решения руководителю; null — не показывать. */
  gate: { copy: TransitionCopy; blocking: boolean; payHref: string | null } | null;
  /** Тонкая плашка «Руководитель выбирает тариф». */
  staffNotice: boolean;
  /** Выставлен счёт по безналу и ещё не оплачен — ждём деньги, не давим. */
  pendingInvoice: boolean;
  /** Надписи «тестовый режим, оплата не списывается» — только до перехода. */
  testModeActive: boolean;
  /** Строка тарифа в шапке. */
  header: { plan: string; label: string | null; note: string | null };
};

async function monthlyTariff(): Promise<Tariff> {
  const tariffs = await readTariffs().catch(() => fallbackTariffs());
  return tariffs.find((t) => t.key === TARIFF_MONTHLY) ?? fallbackTariffs()[0];
}


/**
 * Цена подписки с акцией на момент `at`: окну перехода — сейчас, анонсу —
 * на день перехода (какая цена будет 11-го, если акция к тому дню уже или
 * ещё идёт). Сбой чтения акций — цена без акции (`getDisplayOffer`).
 */
async function monthlyPriceAt(tariff: Tariff, at: Date): Promise<BillingPrice> {
  const offer = await getDisplayOffer(tariff, at);
  return { baseRub: offer.baseRub, priceRub: offer.priceRub, promotion: offer.promotion };
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

  const showAnnouncement = shouldShowAnnouncement(state);
  const tariff = await monthlyTariff();
  const [nowPrice, transitionDayPrice, pendingInvoice] = await Promise.all([
    monthlyPriceAt(tariff, now),
    showAnnouncement && settings.transitionEnabled
      ? monthlyPriceAt(tariff, settings.endsAt)
      : Promise.resolve(null),
    needsDecision ? hasPendingInvoice(unit.scopeOrgIds, now).catch(() => false) : Promise.resolve(false),
  ]);
  const priceRub = nowPrice.priceRub;

  const text = announcementText(settings, transitionDayPrice ?? nowPrice);
  const announcement = showAnnouncement
    ? {
        lead: text.lead,
        // В приложении WeSetup про цену и оплату не говорим (правила
        // сторов) — только сам бесплатный период.
        tail: args.inMobileApp ? null : text.tail,
        tailParts: args.inMobileApp ? null : text.tailParts,
        // Сотрудник страницу тарифа открыть не может — ссылку не даём.
        href: fullAccess ? BILLING_PAY_HREF : null,
        dayKey: mskDayKey(now),
      }
    : null;

  const gate =
    needsDecision && canDecide
      ? {
          copy: transitionCopy({ state, settings, priceRub: nowPrice }),
          // В приложении WeSetup звать к оплате нельзя (правила сторов) —
          // окно без кнопки оплаты и не блокирует. Выставленный счёт —
          // решение уже принято, ждём деньги.
          blocking: !args.inMobileApp && !pendingInvoice,
          payHref: args.inMobileApp ? null : BILLING_PAY_HREF,
        }
      : null;

  const header =
    state.kind === "free_period"
      ? { plan: "paid", label: "Подписка", note: `бесплатно по ${formatMskDay(lastFreeDay(settings))}` }
      : state.kind === "needs_decision"
        ? { plan: "free", label: "Нужно выбрать тариф", note: null }
        : state.kind === "free"
          ? { plan: "free", label: null, note: null }
          : state.kind === "paid"
            ? { plan: "paid", label: "Подписка", note: state.paidUntil ? `до ${formatMskDay(state.paidUntil)}` : null }
            : { plan: unit.plan, label: null, note: null };

  return {
    state,
    settings,
    unit,
    priceRub,
    announcement,
    gate,
    staffNotice: needsDecision && !fullAccess,
    pendingInvoice,
    testModeActive: BILLING_TEST_MODE && state.kind === "legacy",
    header,
  };
}

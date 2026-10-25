import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { emitWebhook } from "@/lib/webhooks/dispatch";
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
} from "@/lib/invite-tokens";
import {
  markClosingDocumentEmailed,
  prepareClosingDocumentEmail,
} from "@/lib/closing-documents/service";
import { sendPaymentReceiptEmail } from "@/lib/email";
import { resolveLocale } from "@/i18n/locales";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { describeHardwareConfig } from "@/lib/hardware-pricing";
import { formatRub } from "@/lib/tariffs";
import { defaultJournalAutomationJson } from "@/lib/journal-automation";
import { DEFAULT_OFF_JOURNAL_CODES } from "@/lib/health-check-default-off";
import { attachAccountForNewOrganization } from "@/lib/create-organization";
import { bindLifetimeDiscountForOrder } from "@/lib/promo/lifetime";
import { recordAuditLog } from "@/lib/audit-log";
import { loadAccountBilling, stateForUnit, type LoadedBilling } from "@/lib/billing.server";
import { TOPUP_TARIFF_KEY } from "@/lib/balance/topup-core";
import { notifyManagement } from "@/lib/notifications";
import { subscriptionFromState } from "@/lib/plan-checkout.server";
import { planAfterPayment, planOrderStillMatches, type PaidPlanUpdate } from "@/lib/plan-payment";
import { parsePlanTariffKey } from "@/lib/tariff-plans";

/**
 * Что происходит после подтверждённой оплаты.
 *
 * Вынесено из вебхука, потому что вебхук обязан ответить Робокассе
 * `OK{InvId}` быстро и ровно один раз: сначала атомарно помечаем заказ
 * оплаченным, потом уже спокойно заводим организацию и рассылаем
 * уведомления.
 *
 * Два сценария:
 *   • почта неизвестна → заводим Organization + User (как при обычной
 *     регистрации) и выдаём одноразовый токен, по которому клиент
 *     дозаполнит профиль и задаст пароль;
 *   • почта известна → просто продлеваем подписку существующей
 *     организации, ничего не создавая.
 */

export type FulfillmentResult = {
  organizationId: string;
  userId: string;
  /// Сырой токен достройки профиля. Null, если клиент уже существовал —
  /// ему достраивать нечего, он входит своим паролем.
  completeToken: string | null;
  isNewClient: boolean;
  subscriptionEnd: Date;
  /**
   * Заказ тарифа не применён: подписка аккаунта изменилась после оформления
   * (`planOrderStillMatches`) — оплату разбирают вручную, тариф не тронут.
   */
  held?: boolean;
};

const APP_URL = (
  process.env.NEXTAUTH_URL ||
  process.env.APP_URL ||
  "https://wesetup.ru"
).replace(/\/+$/, "");

/**
 * Продлевает подписку от большей из дат «сейчас» и «текущий конец»:
 * оплата за месяц вперёд не должна сгорать, если клиент заплатил
 * до истечения предыдущего периода.
 */
function extendFrom(current: Date | null, periodDays: number): Date {
  const base =
    current && current.getTime() > Date.now() ? current.getTime() : Date.now();
  return new Date(base + periodDays * 24 * 60 * 60 * 1000);
}

type FulfillableOrder = {
  id: number;
  email: string;
  tariffKey: string;
  description: string;
  bundleConfig: unknown;
  amountRub: unknown;
  /** Человек отметил согласие на автосписания при оплате. */
  recurringConsent?: boolean;
  /** Заполнено у автосписаний серии — родительский заказ. */
  recurringChargeOf?: number | null;
  /**
   * Организация, из кабинета которой оформили заказ. Заполнена, когда
   * платил вошедший пользователь.
   */
  organizationId?: string | null;
  userId?: string | null;
  /** Сколько баллов ушло в счёт этого заказа (для писем и уведомлений). */
  pointsSpent?: number | null;
  /** Тарифы 2026-10: точки, вид перехода и срок, посчитанные при оформлении. */
  points?: number | null;
  changeKind?: string | null;
  periodEndsAt?: Date | null;
  createdAt?: Date | null;
  /** Снимок подписки, от которой посчитан заказ (`basePlanSnapshot`). */
  basePlanJson?: unknown;
};

export async function fulfillPaidOrder(order: FulfillableOrder): Promise<FulfillmentResult> {
  const result = await extendOrCreateForOrder(order);
  // Скидка навсегда: первая оплаченная подписка с введённым lifetime-кодом
  // привязывает её к аккаунту продлённой организации. Идемпотентно, лог
  // `[promo] lifetime bound …`, аудит; сбой только пишется в лог — деньги
  // уже получены, подписка продлена (lib/promo/lifetime.ts).
  // Заказ на ручном разборе подписку не продлил — привязывать нечего.
  if (!result.held) await bindLifetimeDiscountForOrder(order.id, result.organizationId || null);
  return result;
}

async function extendOrCreateForOrder(order: FulfillableOrder): Promise<FulfillmentResult> {
  const periodDays = await readPeriodDays(order.tariffKey);

  // Организация в заказе — источник правды: платили из её кабинета,
  // продлевать надо именно её. Поиск по почте здесь опасен: у владельца
  // сети «домашняя» организация может быть не той, за которую он платит,
  // и подписка ушла бы не на ту точку.
  if (order.organizationId) {
    const org = await db.organization.findUnique({
      where: { id: order.organizationId },
      select: { id: true, subscriptionEnd: true },
    });
    if (org) {
      const { subscriptionEnd, held } = await extendOrganization({
        organizationId: org.id,
        currentEnd: org.subscriptionEnd,
        periodDays,
        order,
      });
      const userId =
        order.userId ??
        (
          await db.user.findUnique({
            where: { email: order.email },
            select: { id: true },
          })
        )?.id ??
        null;
      return {
        organizationId: org.id,
        userId: userId ?? "",
        completeToken: null,
        isNewClient: false,
        subscriptionEnd,
        held,
      };
    }
  }

  const existing = await db.user.findUnique({
    where: { email: order.email },
    select: { id: true, organizationId: true },
  });

  if (existing) {
    const org = await db.organization.findUnique({
      where: { id: existing.organizationId },
      select: { subscriptionEnd: true },
    });
    const { subscriptionEnd, held } = await extendOrganization({
      organizationId: existing.organizationId,
      currentEnd: org?.subscriptionEnd ?? null,
      periodDays,
      order,
    });
    await db.paymentOrder.update({
      where: { id: order.id },
      data: {
        organizationId: existing.organizationId,
        userId: existing.id,
      },
    });
    return {
      organizationId: existing.organizationId,
      userId: existing.id,
      completeToken: null,
      isNewClient: false,
      subscriptionEnd,
      held,
    };
  }

  // Новый клиент. Пароль ставим случайный: настоящий он задаст сам на
  // экране достройки профиля по одноразовому токену. Пустой хэш класть
  // нельзя — иначе аккаунт остался бы с невалидируемым паролем.
  const passwordHash = await bcrypt.hash(
    crypto.randomBytes(24).toString("base64url"),
    12,
  );
  const plan = planAfterPayment({ order, currentEnd: null, now: new Date() });
  const subscriptionEnd = plan?.subscriptionEnd ?? extendFrom(null, periodDays);
  const subscriptionPlan = plan?.tier ?? "paid";
  const rawToken = generateInviteToken();

  const created = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: `Организация ${order.email}`,
        type: "other",
        subscriptionPlan,
        subscriptionEnd,
        // Автоматика гигиенического журнала — сразу после оплаты.
        journalAutomationJson: defaultJournalAutomationJson(),
        // Журнал здоровья выключен по умолчанию (health-check-default-off.ts).
        disabledJournalCodes: [...DEFAULT_OFF_JOURNAL_CODES],
      },
    });
    const user = await tx.user.create({
      data: {
        email: order.email,
        name: order.email,
        passwordHash,
        role: "manager",
        organizationId: organization.id,
        journalAccessMigrated: true,
      },
    });
    // Аккаунт — владелец тарифа и общего лимита мест (см.
    // lib/create-organization.ts). Оплаченная организация тем более
    // должна уметь расти во вторую точку.
    const { accountId } = await attachAccountForNewOrganization(tx, {
      ownerUserId: user.id,
      organizationId: organization.id,
      subscriptionPlan,
      subscriptionEnd,
    });
    if (plan) {
      await tx.account.update({
        where: { id: accountId },
        data: { planCycle: plan.cycle, planPoints: plan.points },
      });
    }
    await tx.paymentOrder.update({
      where: { id: order.id },
      data: {
        organizationId: organization.id,
        userId: user.id,
        completeTokenHash: hashInviteToken(rawToken),
        completeTokenExpiresAt: inviteExpiresAt(),
      },
    });
    return { organization, user };
  });

  return {
    organizationId: created.organization.id,
    userId: created.user.id,
    completeToken: rawToken,
    isNewClient: true,
    subscriptionEnd,
  };
}

/**
 * Продление подписки существующей организации. Автопродление включает
 * только платёж-РОДИТЕЛЬ серии: у него касса и запоминает карту. Списание
 * внутри серии (`recurringChargeOf`) ничего не переключает — иначе оно бы
 * каждый месяц заново «включало» то, что человек мог отключить.
 *
 * Заказ тарифа 2026-10 (`standard_year` и т. п.) записывает в аккаунт
 * тариф, период и точки, а срок — по виду перехода (`planAfterPayment`):
 * доплата за повышение конец не двигает, продление идёт от текущего
 * конца, новая подписка и переход на год — с момента оплаты. Оплата
 * отменяет запланированное понижение.
 */
async function extendOrganization(args: {
  organizationId: string;
  currentEnd: Date | null;
  periodDays: number;
  order: Pick<
    FulfillableOrder,
    "id" | "tariffKey" | "description" | "recurringConsent" | "recurringChargeOf" | "points" | "changeKind" | "periodEndsAt" | "createdAt" | "basePlanJson"
  >;
}): Promise<{ subscriptionEnd: Date; held: boolean }> {
  // Тариф живёт на аккаунте (сеть платит один раз), организации хранят
  // копии срока, и состояние берёт самый поздний из концов — аккаунта и всех
  // его организаций (`loadBillingUnit`). От него же считаем оплаченный срок.
  const owner = await db.organization.findUnique({
    where: { id: args.organizationId },
    select: { accountId: true },
  });
  const loaded = await loadAccountBilling(args.organizationId);
  const unitEnd = loaded?.unit.subscriptionEnd ?? null;
  const base = unitEnd && (!args.currentEnd || unitEnd.getTime() > args.currentEnd.getTime()) ? unitEnd : args.currentEnd;
  const { order } = args;
  // Организация вне тарифа (демо, мастер-кабинет) подписки не имеет:
  // оформление такую оплату не пропускает (`quoteCheckout`), а пришедший
  // заказ не затирает тариф аккаунта — разбор вручную.
  if (parsePlanTariffKey(order.tariffKey) && (loaded?.unit.exempt || !planOrderMatchesAccount(order, loaded))) {
    await holdStalePlanOrder(order, args.organizationId);
    return { subscriptionEnd: base ?? new Date(), held: true };
  }
  const plan: PaidPlanUpdate | null = planAfterPayment({ order, currentEnd: base, now: new Date() });
  const subscriptionEnd = plan?.subscriptionEnd ?? extendFrom(base, args.periodDays);
  const subscriptionPlan = plan?.tier ?? "paid";
  await db.organization.update({
    where: { id: args.organizationId },
    data: {
      subscriptionPlan,
      subscriptionEnd,
      ...(order.recurringConsent && !order.recurringChargeOf
        ? {
            recurringActive: true,
            recurringParentOrderId: order.id,
            recurringDisabledAt: null,
            recurringFailedAttempts: 0,
          }
        : {}),
    },
  });
  // Раньше оплата продлевала только организацию, а тариф аккаунта
  // оставался прежним: после перехода на бесплатный (2026-10) оплативший
  // видел бы «Бесплатный» в шапке и не мог вернуть сотрудников.
  if (owner?.accountId) {
    await db.account.update({
      where: { id: owner.accountId },
      data: {
        subscriptionPlan,
        subscriptionEnd,
        ...(plan ? { planCycle: plan.cycle, planPoints: plan.points, scheduledPlanJson: Prisma.DbNull } : {}),
      },
    });
  }
  // Копии у остальных организаций аккаунта — тоже: иначе более поздний срок
  // одной из них перекрыл бы оплату. Пауза и отмена остаются у своих
  // организаций (как и при правке ROOT).
  const siblingIds = (loaded?.unit.scopeOrgIds ?? []).filter((id) => id !== args.organizationId);
  if (siblingIds.length > 0) {
    await db.organization.updateMany({ where: { id: { in: siblingIds } }, data: { subscriptionEnd } });
    await db.organization.updateMany({
      where: { id: { in: siblingIds }, subscriptionPlan: { notIn: ["paused", "cancelled"] } },
      data: { subscriptionPlan },
    });
  }
  // Подписка изменилась — открытые счета на подписку, посчитанные от прежней,
  // больше не подходят (их оплата ушла бы на ручной разбор): закрываем.
  if (plan) {
    const organizationIds = owner?.accountId
      ? (await db.organization.findMany({ where: { accountId: owner.accountId }, select: { id: true } })).map((o) => o.id)
      : [args.organizationId];
    const closed = await db.paymentOrder.updateMany({
      where: {
        organizationId: { in: organizationIds },
        paymentMethod: "invoice",
        status: "pending",
        tariffKey: { not: TOPUP_TARIFF_KEY },
        id: { not: order.id },
      },
      data: { status: "cancelled" },
    });
    if (closed.count > 0) console.info(`[billing] order #${order.id}: pending subscription invoices cancelled: ${closed.count}`);
  }
  console.info("[billing] payment extended subscription", {
    organizationId: args.organizationId,
    accountId: owner?.accountId ?? null,
    orderId: order.id,
    plan: subscriptionPlan,
    cycle: plan?.cycle ?? null,
    points: plan?.points ?? null,
    changeKind: plan?.kind ?? "legacy",
    subscriptionEnd: subscriptionEnd.toISOString(),
  });
  return { subscriptionEnd, held: false };
}

/**
 * Заказ тарифа 2026-10 всё ещё подходит к подписке аккаунта (см.
 * `planOrderStillMatches`): снимок из заказа сравниваем с подпиской аккаунта,
 * какой она выглядит сейчас, на момент оформления заказа.
 */
function planOrderMatchesAccount(
  order: Pick<FulfillableOrder, "tariffKey" | "changeKind" | "createdAt" | "basePlanJson">,
  loaded: LoadedBilling | null
): boolean {
  if (!order.createdAt) return true;
  const subscriptionThen = loaded ? subscriptionFromState(stateForUnit(loaded.unit, loaded.settings, order.createdAt)) : null;
  return planOrderStillMatches({
    order: { tariffKey: order.tariffKey, changeKind: order.changeKind, basePlan: order.basePlanJson },
    subscriptionThen,
    planNow: loaded?.unit.plan ?? null,
    now: new Date(),
  });
}

/**
 * Оплату устаревшего заказа не применяем к тарифу: ROOT разбирает её вручную
 * (применить переход или вернуть деньги), руководство видит, что произошло.
 * Оба уведомления best-effort — деньги уже получены.
 */
async function holdStalePlanOrder(
  order: Pick<FulfillableOrder, "id" | "description" | "changeKind">,
  organizationId: string
): Promise<void> {
  console.warn("[billing] stale plan order held for manual review", { orderId: order.id, organizationId });
  // Отметка на заказе (УПД до разбора не выпускается) и строка аудита — след
  // остаётся, даже если Telegram админа не настроен.
  await db.paymentOrder.update({ where: { id: order.id }, data: { heldAt: new Date() } });
  await recordAuditLog({
    organizationId,
    action: "billing.order-held",
    entity: "PaymentOrder",
    entityId: String(order.id),
    details: { orderId: order.id, description: order.description, changeKind: order.changeKind ?? null },
  });
  await notifyPlatformAdmin(
    `⚠️ Оплата заказа №${order.id} не применена к тарифу: после оформления изменилась подписка аккаунта или кончился срок, от которого считалась сумма («${order.description}»). Разобрать вручную — применить переход или вернуть деньги.`,
    { kind: "payment", dedupeKey: `stale-plan-order:${order.id}` },
  ).catch((error) => console.error("[billing] stale order admin notify failed", error));
  await notifyManagement({
    organizationId,
    kind: "billing.order-held",
    dedupeKey: `billing.order-held:${order.id}`,
    title: `Оплата заказа №${order.id} получена — применим её вручную`,
    linkHref: "/settings/subscription",
    linkLabel: "Тариф и оплата",
    items: [
      {
        id: `order-${order.id}`,
        label: "После оформления этого заказа изменилась подписка или закончился оплаченный срок, от которого считалась сумма, поэтому применить его автоматически нельзя. Мы применим оплату или вернём деньги в течение рабочего дня — ничего делать не нужно.",
      },
    ],
  }).catch((error) => console.error("[billing] stale order notify failed", error));
}

async function readPeriodDays(tariffKey: string): Promise<number> {
  const tariff = await db.platformTariff.findUnique({
    where: { key: tariffKey },
    select: { periodDays: true },
  });
  return tariff?.periodDays ?? 30;
}

/**
 * Письмо клиенту и уведомление владельцу. Обе рассылки best-effort:
 * упавшая почта или недоступный Telegram не должны ломать вебхук —
 * деньги уже получены, доступ уже выдан.
 */
export async function notifyAboutPayment(args: {
  order: {
    id: number;
    email: string;
    description: string;
    amountRub: unknown;
    bundleConfig: unknown;
    isTest: boolean;
    pointsSpent?: number | null;
  };
  result: FulfillmentResult;
}): Promise<void> {
  const { order, result } = args;
  const amount = Number(order.amountRub);
  const pointsSpent = Math.max(0, Number(order.pointsSpent ?? 0));
  const completeUrl = result.completeToken
    ? `${APP_URL}/order?complete=${result.completeToken}`
    : `${APP_URL}/login`;

  // Закрывающий документ (УПД) — вложением в это же письмо. Best-effort:
  // без реквизитов исполнителя или при сбое рендера письмо уходит как
  // раньше, без вложения; документ клиент скачает из кабинета позже.
  // Устаревший заказ ждёт ручного разбора: документ — после него.
  const closingDocument = order.isTest || result.held
    ? null
    : await prepareClosingDocumentEmail(order.id, {
        subscriptionEnd: result.subscriptionEnd,
        organizationId: result.organizationId,
      });

  if (result.organizationId) {
    emitWebhook(result.organizationId, "payment.paid", { orderId: order.id, amountRub: amount, description: order.description, subscriptionEnd: result.subscriptionEnd ? new Date(result.subscriptionEnd).toISOString() : null });
  }

  const recipient = result.organizationId ? await db.user.findFirst({ where: { email: order.email, organizationId: result.organizationId }, select: { locale: true } }) : null;
  const organizationLocale = result.organizationId ? await db.organization.findUnique({ where: { id: result.organizationId }, select: { locale: true } }) : null;
  const locale = resolveLocale({ authenticated: Boolean(recipient), userLocale: recipient?.locale, organizationLocale: organizationLocale?.locale });
  const sent = await sendPaymentReceiptEmail({
    to: order.email,
    amountRub: amount,
    description: order.description,
    actionUrl: completeUrl,
    isNewClient: result.isNewClient,
    subscriptionEnd: result.subscriptionEnd,
    organizationId: result.organizationId,
    pointsSpent,
    closingDocument,
    locale,
    held: result.held === true,
  }).catch((err) => {
    console.error("sendPaymentReceiptEmail failed", err);
    return false;
  });
  if (sent && closingDocument) {
    await markClosingDocumentEmailed(order.id).catch(() => undefined);
  }

  const hardware = describeHardwareConfig(
    (order.bundleConfig as Record<string, number>) ?? {},
  );
  // «Сумма» показывает то, что реально пришло деньгами, а списанные
  // баллы стоят рядом: иначе платёж на 1 490 ₽ при цене 1 990 ₽ выглядел
  // бы недоплатой.
  const amountLine =
    amount <= 0 && pointsSpent > 0
      ? `Сумма: оплачено баллами (${formatRub(pointsSpent)})`
      : pointsSpent > 0
        ? `Сумма: ${formatRub(amount)} (+ ${formatRub(pointsSpent)} баллами)`
        : `Сумма: ${formatRub(amount)}`;
  const lines = [
    order.isTest ? "🧪 ТЕСТОВЫЙ платёж" : "💰 Оплата получена",
    amountLine,
    `Тариф: ${order.description}`,
    `Почта: ${order.email}`,
    result.isNewClient
      ? "Новый клиент — организация создана автоматически"
      : result.held
        ? "⚠️ Тариф не изменён: подписка или срок поменялись после оформления заказа — разобрать вручную"
        : "Существующий клиент — подписка продлена",
    `Подписка до: ${result.subscriptionEnd.toLocaleDateString("ru-RU")}`,
    `Заказ №${order.id}`,
  ];
  if (hardware.length > 0) {
    lines.push("", "Оборудование к отгрузке:", ...hardware.map((h) => `• ${h}`));
  }

  // Оплаты идут в ту же единую точку, что регистрации и обращения.
  await notifyPlatformAdmin(lines.join("\n"), { kind: "payment" }).catch((err) =>
    console.error("payment telegram notify failed", err),
  );
}

/**
 * Всё, что происходит после подтверждённой оплаты, в одном месте.
 *
 * Раньше эта цепочка жила прямо в вебхуке. Теперь у неё два вызывающих:
 * вебхук Робокассы и ветка «заказ полностью закрыт баллами», где кассы
 * вообще нет. Каждый шаг в своём try/catch: деньги уже получены, и
 * упавшая почта или недоступный Telegram не должны ломать ответ кассе.
 */
export async function completePaidOrder(order: {
  id: number;
  email: string;
  tariffKey: string;
  description: string;
  bundleConfig: unknown;
  amountRub: unknown;
  isTest: boolean;
  recurringConsent?: boolean;
  recurringChargeOf?: number | null;
  organizationId?: string | null;
  userId?: string | null;
  pointsSpent?: number | null;
  partnerSlug?: string | null;
  referrerOrganizationId?: string | null;
  points?: number | null;
  changeKind?: string | null;
  periodEndsAt?: Date | null;
  createdAt?: Date | null;
  basePlanJson?: unknown;
}): Promise<{ organizationId: string | null; isNewClient: boolean }> {
  // Пополнение баланса — не подписка: не продлеваем, скидку навсегда не
  // привязываем, реферальную награду не запускаем. Баллы уже зачислены в
  // той же транзакции, что и перевод заказа в paid (settlePaidOrder);
  // здесь — комиссия партнёру, уведомления и аудит.
  const { isTopupOrder } = await import("@/lib/balance/topup-core");
  if (isTopupOrder(order)) {
    const { completeTopupOrder } = await import("@/lib/balance/topup");
    return completeTopupOrder(order.id);
  }

  const { accrueForPaidOrder } = await import("@/lib/partners/accruals");
  const { attachOrganizationByRef, parsePartnerRef } = await import(
    "@/lib/partners/referral"
  );
  const { accrueReferralReward, attachReferral } = await import(
    "@/lib/balance/referral"
  );

  let organizationId: string | null = null;
  let isNewClient = false;
  try {
    const result = await fulfillPaidOrder(order);
    organizationId = result.organizationId;
    isNewClient = result.isNewClient;
    await notifyAboutPayment({ order, result });
  } catch (error) {
    // Заказ уже помечен оплаченным — откатывать статус нельзя, иначе
    // повторное уведомление создаст вторую организацию. Разбор руками
    // через /root по номеру заказа.
    console.error(`fulfillment failed for order ${order.id}`, error);
  }

  // Партнёрская программа: метка /p/<slug> привязывает новую организацию
  // к партнёру, затем считается вознаграждение с реально уплаченных денег.
  try {
    if (organizationId) {
      await attachOrganizationByRef({
        ref: parsePartnerRef(order.partnerSlug ?? null),
        organizationId,
        actorUserId: null,
      });
    }
    await accrueForPaidOrder(order.id);
  } catch (error) {
    console.error(`partner accrual failed for order ${order.id}`, error);
  }

  // Реферальная программа клиент → клиент. Привязку по метке из заказа
  // делаем только для НОВОЙ организации: у существующей атрибуция либо
  // уже есть, либо она пришла своим путём.
  try {
    if (organizationId && isNewClient) {
      await attachReferral({
        organizationId,
        referrerOrganizationId: order.referrerOrganizationId ?? null,
      });
    }
    await accrueReferralReward(order.id);
  } catch (error) {
    console.error(`referral reward failed for order ${order.id}`, error);
  }

  return { organizationId, isNewClient };
}

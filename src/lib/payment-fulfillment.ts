import bcrypt from "bcryptjs";
import crypto from "node:crypto";
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
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { describeHardwareConfig } from "@/lib/hardware-pricing";
import { formatRub } from "@/lib/tariffs";
import { defaultJournalAutomationJson } from "@/lib/journal-automation";
import { DEFAULT_OFF_JOURNAL_CODES } from "@/lib/health-check-default-off";
import { attachAccountForNewOrganization } from "@/lib/create-organization";

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

export async function fulfillPaidOrder(order: {
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
}): Promise<FulfillmentResult> {
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
      const subscriptionEnd = await extendOrganization({
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
    const subscriptionEnd = await extendOrganization({
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
    };
  }

  // Новый клиент. Пароль ставим случайный: настоящий он задаст сам на
  // экране достройки профиля по одноразовому токену. Пустой хэш класть
  // нельзя — иначе аккаунт остался бы с невалидируемым паролем.
  const passwordHash = await bcrypt.hash(
    crypto.randomBytes(24).toString("base64url"),
    12,
  );
  const subscriptionEnd = extendFrom(null, periodDays);
  const rawToken = generateInviteToken();

  const created = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: `Организация ${order.email}`,
        type: "other",
        subscriptionPlan: "paid",
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
    await attachAccountForNewOrganization(tx, {
      ownerUserId: user.id,
      organizationId: organization.id,
      subscriptionPlan: "paid",
      subscriptionEnd,
    });
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
 */
async function extendOrganization(args: {
  organizationId: string;
  currentEnd: Date | null;
  periodDays: number;
  order: { id: number; recurringConsent?: boolean; recurringChargeOf?: number | null };
}): Promise<Date> {
  // Тариф живёт на аккаунте (сеть платит один раз): оплаченный срок
  // считаем от самого позднего из концов — организации и аккаунта.
  const owner = await db.organization.findUnique({
    where: { id: args.organizationId },
    select: { accountId: true, account: { select: { subscriptionEnd: true } } },
  });
  const accountEnd = owner?.account?.subscriptionEnd ?? null;
  const base =
    accountEnd && (!args.currentEnd || accountEnd.getTime() > args.currentEnd.getTime())
      ? accountEnd
      : args.currentEnd;
  const subscriptionEnd = extendFrom(base, args.periodDays);
  const { order } = args;
  await db.organization.update({
    where: { id: args.organizationId },
    data: {
      subscriptionPlan: "paid",
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
      data: { subscriptionPlan: "paid", subscriptionEnd },
    });
  }
  console.info("[billing] payment extended subscription", {
    organizationId: args.organizationId,
    accountId: owner?.accountId ?? null,
    orderId: order.id,
    subscriptionEnd: subscriptionEnd.toISOString(),
  });
  return subscriptionEnd;
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
  const closingDocument = order.isTest
    ? null
    : await prepareClosingDocumentEmail(order.id, {
        subscriptionEnd: result.subscriptionEnd,
        organizationId: result.organizationId,
      });

  if (result.organizationId) {
    emitWebhook(result.organizationId, "payment.paid", { orderId: order.id, amountRub: amount, description: order.description, subscriptionEnd: result.subscriptionEnd ? new Date(result.subscriptionEnd).toISOString() : null });
  }

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
}): Promise<{ organizationId: string | null; isNewClient: boolean }> {
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

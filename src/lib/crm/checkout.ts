/**
 * Незавершённая оплата в CRM (спека checkout-conversion-2026-11-22).
 *
 * Человек открыл оформление (`/order`) или нажал «Перейти к оплате» — в ленту
 * CRM ложится событие канала `checkout` (одно на почту в сутки по Москве).
 * Через 30 минут без оплаты и без счёта прогон CRM ставит задачу «позвонить»
 * и пишет админам в Telegram. Оплатил — задачи по незавершённой оплате
 * закрываются, а для новой подписки ставится другая: созвон по запуску.
 *
 * Чистый модуль: ключи, записи ленты, выбор и тексты. Запись и отправка —
 * `checkout.server.ts`.
 */

import { CRM_BODY_MAX } from "@/lib/crm/constants";
import { truncateBody } from "@/lib/crm/mail-text";
import { moscowDateKey } from "@/lib/crm/reminders";
import { contactEmail, type CrmIngestItem } from "@/lib/crm/sources";
import { escapeHtml } from "@/lib/html-escape";
import { planTariffTitle } from "@/lib/plan-payment";
import { normalizePoints, parsePlanTariffKey } from "@/lib/tariff-plans";

export const CHECKOUT_CHANNEL = "checkout";
export const PAYMENT_CHANNEL = "payment";
/** Столько ждём оплату после начала оформления, прежде чем звать менеджера. */
export const CHECKOUT_ABANDON_AFTER_MS = 30 * 60 * 1000;
/** Дальше это уже не «только что ушёл со страницы»: письмо клиенту и общая очередь. */
export const CHECKOUT_ABANDON_GIVE_UP_MS = 72 * 60 * 60 * 1000;
/** Заказ мог появиться чуть раньше записи (гость нажал оплату, не уходя с поля почты). */
export const CHECKOUT_ORDER_GRACE_MS = 10 * 60 * 1000;
/** Срок задачи «созвон по запуску» после оплаты. */
export const ONBOARDING_DUE_MS = 2 * 60 * 60 * 1000;

const VISIT_PREFIX = "checkout:visit:";
const TOPUP_TARIFF = "balance_topup";

/** Одна запись оформления на почту в сутки по Москве: повторные заходы её не множат. */
export function checkoutVisitKey(email: string, at: Date): string {
  return `${VISIT_PREFIX}${email.trim().toLowerCase()}:${moscowDateKey(at)}`;
}

export function isCheckoutVisitKey(key: string): boolean {
  return key.startsWith(VISIT_PREFIX);
}

/** Ключ задачи «незавершённая оплата»: одна на запись оформления. */
export function checkoutTaskKey(interactionId: string): string {
  return `checkout:abandoned:${interactionId}`;
}

/** Ключ задачи «созвон по запуску»: одна на оплаченный заказ. */
export function onboardingTaskKey(orderId: number): string {
  return `paid:onboarding:${orderId}`;
}

/** Ссылка «продолжить оплату» на тот же тариф, период и точки. */
export function checkoutContinuePath(tariffKey: string, points: number | null | undefined): string {
  const plan = parsePlanTariffKey(tariffKey) ?? { tier: "standard" as const, cycle: "year" as const };
  const query = new URLSearchParams({ plan: plan.tier, cycle: plan.cycle, points: String(normalizePoints(points ?? 1)) });
  return `/order?${query.toString()}`;
}

export function formatCheckoutRub(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(value))} ₽`;
}

export type CheckoutVisit = {
  email: string;
  tariffKey: string;
  points: number | null;
  /** Сумма на странице (цена тарифа с акцией), ₽. */
  amountRub: number;
  at: Date;
  /** page — вошедший открыл страницу; guest — гость ввёл почту; order — создан заказ картой. */
  source: "page" | "guest" | "order";
  orderId?: number | null;
  userId?: string | null;
  organizationId?: string | null;
  name?: string | null;
  phone?: string | null;
  company?: string | null;
};

const VISIT_SUBJECT: Record<CheckoutVisit["source"], string> = {
  page: "Открыл(а) оформление оплаты",
  guest: "Открыл(а) оформление оплаты, ввёл(а) почту",
  order: "Перешёл(ла) к оплате картой",
};

/**
 * Событие ленты CRM. Почта служебная или кривая — null: звонить некому.
 * Ссылка «продолжить» — абсолютная: её копируют клиенту в мессенджер.
 */
export function mapCheckoutVisit(visit: CheckoutVisit, appUrl: string): CrmIngestItem | null {
  const email = contactEmail(visit.email);
  if (!email || visit.tariffKey === TOPUP_TARIFF) return null;
  const title = planTariffTitle(visit.tariffKey, visit.points) ?? visit.tariffKey;
  const amount = visit.amountRub > 0 ? ` — ${formatCheckoutRub(visit.amountRub)}` : "";
  const lines = [
    `Тариф: ${title}${amount}`,
    visit.orderId ? `Заказ № ${visit.orderId}` : null,
    `Продолжить оплату: ${appUrl.replace(/\/+$/, "")}${checkoutContinuePath(visit.tariffKey, visit.points)}`,
  ];
  return {
    externalKey: checkoutVisitKey(email, visit.at),
    channel: CHECKOUT_CHANNEL,
    direction: "event",
    subject: VISIT_SUBJECT[visit.source],
    body: truncateBody(lines.filter(Boolean).join("\n"), CRM_BODY_MAX),
    href: null,
    occurredAt: visit.at,
    identity: {
      email,
      phone: visit.phone?.trim() || null,
      name: visit.name?.trim() || null,
      company: visit.company?.trim() || null,
      userId: visit.userId ?? null,
      organizationId: visit.organizationId ?? null,
    },
  };
}

export type CheckoutOrderRow = {
  id: number;
  email: string;
  tariffKey: string;
  points: number | null;
  amountRub: number;
  createdAt: Date;
  organizationId: string | null;
  userId: string | null;
};

/** Заказ картой (источник CRM `checkout`): тот же ключ дня, что и у захода на страницу. */
export function mapCheckoutOrder(row: CheckoutOrderRow, appUrl: string): CrmIngestItem | null {
  return mapCheckoutVisit(
    {
      email: row.email,
      tariffKey: row.tariffKey,
      points: row.points,
      amountRub: row.amountRub,
      at: row.createdAt,
      source: "order",
      orderId: row.id,
      userId: row.userId,
      organizationId: row.organizationId,
    },
    appUrl,
  );
}

export type CheckoutOrderState = { status: string; paymentMethod: string; createdAt: Date };

export type CheckoutCandidate = {
  occurredAt: Date;
  contactStage: string;
  /** У контакта уже есть открытая задача «незавершённая оплата». */
  hasOpenTask: boolean;
  /** Заказы с этой почты или организации, созданные после начала оформления. */
  orders: readonly CheckoutOrderState[];
};

export type CheckoutStep = "opened" | "payment_started";

export type CheckoutDecision =
  | { action: "alert"; step: CheckoutStep }
  | { action: "skip"; reason: "too_early" | "too_old" | "paid" | "invoice" | "spam" | "open_task" };

const PAID = new Set(["paid", "completed"]);

/**
 * Звать ли менеджера по записи оформления. Оплатил или выставил счёт после
 * начала — нет (у счёта своё уведомление и свои сроки). Нажимал «Перейти к
 * оплате» и не заплатил — шаг сильнее, чем просто открыл страницу.
 */
export function decideAbandonedCheckout(candidate: CheckoutCandidate, now: Date): CheckoutDecision {
  const age = now.getTime() - candidate.occurredAt.getTime();
  if (age < CHECKOUT_ABANDON_AFTER_MS) return { action: "skip", reason: "too_early" };
  if (age > CHECKOUT_ABANDON_GIVE_UP_MS) return { action: "skip", reason: "too_old" };
  if (candidate.contactStage === "spam") return { action: "skip", reason: "spam" };
  const from = candidate.occurredAt.getTime() - CHECKOUT_ORDER_GRACE_MS;
  const after = candidate.orders.filter((order) => order.createdAt.getTime() >= from);
  if (after.some((order) => PAID.has(order.status))) return { action: "skip", reason: "paid" };
  if (after.some((order) => order.paymentMethod === "invoice" && order.status === "pending")) return { action: "skip", reason: "invoice" };
  if (candidate.hasOpenTask) return { action: "skip", reason: "open_task" };
  const started = after.some((order) => order.paymentMethod === "card");
  return { action: "alert", step: started ? "payment_started" : "opened" };
}

export const CHECKOUT_STEP_LABELS: Record<CheckoutStep, string> = {
  opened: "открыл(а) страницу оплаты и ушёл(ла)",
  payment_started: "нажал(а) «Перейти к оплате», но не оплатил(а)",
};

export type CheckoutContact = {
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
};

function who(contact: CheckoutContact): string {
  return contact.company?.trim() || contact.name?.trim() || contact.email || "клиент";
}

function minutesAgo(occurredAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - occurredAt.getTime()) / 60_000));
  if (minutes < 90) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} ч назад` : `${Math.round(hours / 24)} дн. назад`;
}

/** Задача CRM и сообщение админам в Telegram (HTML) по незавершённой оплате. */
export function composeAbandonedCheckout(args: {
  contact: CheckoutContact;
  /** Текст записи оформления: тариф, сумма, ссылка «продолжить». */
  visitBody: string;
  step: CheckoutStep;
  occurredAt: Date;
  now: Date;
  taskUrl: string | null;
}): { title: string; note: string; telegram: string } {
  const name = who(args.contact);
  const contacts = [args.contact.phone?.trim() || null, args.contact.email].filter(Boolean).join(", ");
  const step = CHECKOUT_STEP_LABELS[args.step];
  const note = [
    `Начал(а) оформление ${minutesAgo(args.occurredAt, args.now)}, ${step}.`,
    args.visitBody,
    contacts ? `Контакты: ${contacts}` : null,
    args.contact.phone ? "Позвоните: помогите выбрать способ оплаты, предложите счёт для юрлица." : "Телефона нет — напишите на почту, предложите счёт для юрлица или звонок.",
  ]
    .filter(Boolean)
    .join("\n");
  const telegram = [
    "🛒 <b>Не завершил(а) оплату</b>",
    `Кто: ${escapeHtml(name)}`,
    contacts ? `Контакты: ${escapeHtml(contacts)}` : null,
    escapeHtml(args.visitBody),
    `Шаг: ${escapeHtml(step)} (${escapeHtml(minutesAgo(args.occurredAt, args.now))})`,
    args.taskUrl ? `<a href="${escapeHtml(args.taskUrl)}">Задача в CRM: позвонить</a>` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return { title: `Незавершённая оплата: ${name}`.slice(0, 200), note, telegram };
}

/** Новая подписка, повышение или переход — звоним помочь с запуском; продление и тест — нет. */
export function needsOnboardingTask(order: { isTest: boolean; tariffKey: string; changeKind?: string | null }, isNewClient: boolean): boolean {
  if (order.isTest || order.tariffKey === TOPUP_TARIFF) return false;
  if (isNewClient) return true;
  return order.changeKind == null || order.changeKind === "new" || order.changeKind === "upgrade" || order.changeKind === "switch";
}

export function composeOnboardingTask(args: {
  contact: CheckoutContact;
  orderId: number;
  description: string;
  amountRub: number;
  isNewClient: boolean;
  changeKind?: string | null;
}): { title: string; note: string } {
  const name = who(args.contact);
  const contacts = [args.contact.phone?.trim() || null, args.contact.email].filter(Boolean).join(", ");
  const what = args.isNewClient
    ? "Новый клиент оплатил"
    : args.changeKind === "upgrade"
      ? "Повысил(а) тариф"
      : args.changeKind === "switch"
        ? "Перешёл(ла) на другой тариф"
        : "Оплатил(а) подписку";
  return {
    title: `Оплатил: ${name} — созвон по запуску`.slice(0, 200),
    note: [
      `${what}: заказ № ${args.orderId}, ${args.description} — ${formatCheckoutRub(args.amountRub)}.`,
      contacts ? `Контакты: ${contacts}` : null,
      "Поздравьте, помогите с запуском: сотрудники, журналы, Telegram; спросите, всё ли понятно.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** Событие оплаты в ленте контакта. */
export function mapPaidOrder(args: {
  orderId: number;
  email: string;
  description: string;
  amountRub: number;
  pointsSpent: number;
  organizationId: string | null;
  userId: string | null;
  at: Date;
}): CrmIngestItem | null {
  const email = contactEmail(args.email);
  if (!email && !args.organizationId) return null;
  const sum =
    args.amountRub > 0
      ? formatCheckoutRub(args.amountRub) + (args.pointsSpent > 0 ? ` + ${formatCheckoutRub(args.pointsSpent)} баллами` : "")
      : `баллами ${formatCheckoutRub(args.pointsSpent)}`;
  return {
    externalKey: `payment:${args.orderId}`,
    channel: PAYMENT_CHANNEL,
    direction: "event",
    subject: `Оплата заказа № ${args.orderId}`,
    body: truncateBody(`${args.description} — ${sum}`, CRM_BODY_MAX),
    href: null,
    occurredAt: args.at,
    identity: { email, organizationId: args.organizationId, userId: args.userId },
  };
}

import { CONTACT_PHONE } from "@/lib/contact-us";
import { escapeHtml } from "@/lib/html-escape";
import { normalizePoints, parsePlanTariffKey } from "@/lib/tariff-plans";

/**
 * Брошенные заказы (2026-11-01): человек нажал «Оплатить картой», ушёл в
 * кассу и не заплатил. Через час — одно письмо со ссылкой продолжить тот же
 * тариф, предложением счёта для юрлица и телефоном. Чистый модуль: выбор
 * заказов и текст; отправка — `abandoned-orders.server.ts` (ежечасный крон).
 */

export const ABANDONED_ACTION = "payment.abandoned.reminded";
export const ABANDONED_AFTER_MS = 60 * 60 * 1000;
export const ABANDONED_GIVE_UP_MS = 72 * 60 * 60 * 1000;

export type PendingOrder = {
  id: number;
  email: string;
  tariffKey: string;
  points: number | null;
  amountRub: number;
  description: string;
  createdAt: Date;
};

/**
 * Кому писать: заказ в окне 1–72 часа, по одному письму на почту за окно
 * (самый свежий заказ), без оплаты с этой почты после заказа, не из
 * стоп-листа рассылок, и почте ещё не писали за эти 72 часа.
 */
export function pickAbandonedOrders(
  orders: readonly PendingOrder[],
  context: {
    now: Date;
    /** Почта → самая поздняя оплата (создание оплаченного заказа). */
    paidAfter: ReadonlyMap<string, Date>;
    /** Почты, которым уже писали в окне. */
    remindedEmails: ReadonlySet<string>;
    suppressed: ReadonlySet<string>;
  },
): PendingOrder[] {
  const now = context.now.getTime();
  const latestByEmail = new Map<string, PendingOrder>();
  for (const order of orders) {
    const age = now - order.createdAt.getTime();
    if (age < ABANDONED_AFTER_MS || age > ABANDONED_GIVE_UP_MS) continue;
    const email = order.email.trim().toLowerCase();
    const current = latestByEmail.get(email);
    if (!current || order.createdAt > current.createdAt) latestByEmail.set(email, order);
  }
  return [...latestByEmail.entries()]
    .filter(([email, order]) => {
      if (context.remindedEmails.has(email) || context.suppressed.has(email)) return false;
      const paid = context.paidAfter.get(email);
      return !paid || paid.getTime() < order.createdAt.getTime();
    })
    .map(([, order]) => order);
}

/** Ссылка вернуться к тому же тарифу, периоду и точкам. */
export function continueOrderPath(order: Pick<PendingOrder, "tariffKey" | "points">, extra = ""): string {
  const plan = parsePlanTariffKey(order.tariffKey) ?? { tier: "standard" as const, cycle: "year" as const };
  const query = new URLSearchParams({ plan: plan.tier, cycle: plan.cycle, points: String(normalizePoints(order.points ?? 1)) });
  return `/order?${query.toString()}${extra}`;
}

function rub(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}

export function composeAbandonedOrderEmail(
  order: PendingOrder,
  appUrl: string,
  options: { invoice: boolean } = { invoice: true },
): { subject: string; title: string; html: string } {
  const P = 'style="margin:0 0 16px;color:#3f3f46;line-height:1.6"';
  const AFTER_BUTTON = 'style="margin:20px 0 0;color:#3f3f46;line-height:1.6"';
  const NOTE = 'style="margin:16px 0 0;color:#6f7282;line-height:1.6;font-size:13px"';
  const BUTTON =
    'style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px"';
  const continueUrl = `${appUrl}${continueOrderPath(order)}`;
  const invoiceUrl = `${appUrl}${continueOrderPath(order, "#invoice")}`;
  return {
    subject: "Оплата WeSetup не завершена",
    title: "Оплата не завершена",
    html:
      `<p ${P}>Здравствуйте! Вы начали оформлять «${escapeHtml(order.description)}» на ${rub(order.amountRub)}, но оплата не дошла до конца. Деньги не списаны.</p>` +
      `<a href="${continueUrl}" ${BUTTON}>Продолжить оплату</a>` +
      // Строка про счёт — только когда счёт можно выставить (реквизиты WeSetup заполнены).
      (options.invoice
        ? `<p ${AFTER_BUTTON}>Платите от организации? <a href="${invoiceUrl}" style="color:#3848c7">Выставим счёт по ИНН без регистрации</a> — PDF придёт на почту сразу.</p>`
        : "") +
      `<p ${NOTE}>Что-то не получилось с оплатой — ответьте на это письмо или позвоните: ${CONTACT_PHONE.display}. Передумали — просто удалите письмо, больше напоминать не будем.</p>`,
  };
}

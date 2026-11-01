import { readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { db } from "@/lib/db";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import { invoiceRequisitesReady } from "@/lib/invoices/build";
import { platformOrgId } from "@/lib/partners/partner-hint";
import { PAID_ORDER_STATUSES } from "@/lib/promo/service";
import { SUPPORT_EMAIL } from "@/lib/support-chat-bus";

import {
  ABANDONED_ACTION,
  ABANDONED_AFTER_MS,
  ABANDONED_GIVE_UP_MS,
  composeAbandonedOrderEmail,
  pickAbandonedOrders,
} from "./abandoned-orders";

export type AbandonedReport = { scanned: number; sent: number; skipped: number; reason?: string };

/** Пополнение баланса — не оформление тарифа: о нём не напоминаем. */
const TOPUP_TARIFF = "balance_topup";

/**
 * Письма по брошенным заказам. Зовётся из ежечасного крона `weekly-digest`.
 * Отметка о письме — запись `payment.abandoned.reminded` в журнале действий
 * платформы (у гостевого заказа своей организации нет): по почте, чтобы не
 * писать второй раз за 72 часа. Отметка — только после успешной отправки.
 */
export async function runAbandonedOrderReminders(options: { now?: Date; dryRun?: boolean } = {}): Promise<AbandonedReport> {
  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - ABANDONED_GIVE_UP_MS);
  const to = new Date(now.getTime() - ABANDONED_AFTER_MS);
  const rows = await db.paymentOrder.findMany({
    where: {
      status: "pending",
      paymentMethod: "card",
      isTest: false,
      tariffKey: { not: TOPUP_TARIFF },
      createdAt: { gte: from, lte: to },
    },
    select: { id: true, email: true, tariffKey: true, points: true, amountRub: true, description: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  if (rows.length === 0) return { scanned: 0, sent: 0, skipped: 0 };

  const orders = rows.map((row) => ({ ...row, amountRub: Number(row.amountRub) }));
  const emails = [...new Set(orders.map((order) => order.email.trim().toLowerCase()))];
  const platform = platformOrgId();
  const [paidRows, remindedRows, suppressedRows] = await Promise.all([
    db.paymentOrder.findMany({
      where: { email: { in: emails }, status: { in: [...PAID_ORDER_STATUSES] }, createdAt: { gte: from } },
      select: { email: true, createdAt: true },
    }),
    db.auditLog.findMany({
      where: { organizationId: platform, action: ABANDONED_ACTION, createdAt: { gte: from } },
      select: { details: true },
    }),
    db.emailSuppression.findMany({ where: { email: { in: emails } }, select: { email: true } }),
  ]);
  const paidAfter = new Map<string, Date>();
  for (const row of paidRows) {
    const email = row.email.trim().toLowerCase();
    const known = paidAfter.get(email);
    if (!known || row.createdAt > known) paidAfter.set(email, row.createdAt);
  }
  const remindedEmails = new Set(
    remindedRows
      .map((row) => (row.details && typeof row.details === "object" ? (row.details as { email?: unknown }).email : null))
      .filter((email): email is string => typeof email === "string")
      .map((email) => email.toLowerCase()),
  );
  const suppressed = new Set(suppressedRows.map((row) => row.email.toLowerCase()));
  const picked = pickAbandonedOrders(orders, { now, paidAfter, remindedEmails, suppressed });

  const report: AbandonedReport = { scanned: orders.length, sent: 0, skipped: orders.length - picked.length };
  if (options.dryRun) return { ...report, reason: "dry-run" };
  const appUrl = process.env.NEXTAUTH_URL || "https://wesetup.ru";
  const invoice = invoiceRequisitesReady(await readPlatformRequisites());
  for (const order of picked) {
    const email = order.email.trim().toLowerCase();
    const mail = composeAbandonedOrderEmail(order, appUrl, { invoice });
    const delivered = await sendRawEmail(email, mail.subject, renderEmailLayout(mail.title, mail.html), { replyTo: SUPPORT_EMAIL }).catch(
      (error: unknown) => {
        console.error("[abandoned-orders] send failed", { order: order.id, error });
        return false;
      },
    );
    if (!delivered) {
      report.skipped += 1;
      continue;
    }
    await db.auditLog
      .create({
        data: {
          organizationId: platform,
          action: ABANDONED_ACTION,
          entity: "PaymentOrder",
          entityId: String(order.id),
          details: { email, tariffKey: order.tariffKey, amountRub: order.amountRub },
        },
      })
      .catch((error: unknown) => console.error("[abandoned-orders] audit failed", { order: order.id, error }));
    report.sent += 1;
  }
  return report;
}

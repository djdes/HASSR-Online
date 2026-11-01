import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ABANDONED_ACTION,
  composeAbandonedOrderEmail,
  continueOrderPath,
  pickAbandonedOrders,
  type PendingOrder,
} from "@/lib/abandoned-orders";
import { CONTACT_PHONE } from "@/lib/contact-us";
import { PAYMENT_GOALS } from "@/lib/payment-goals";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const now = new Date("2026-11-02T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);
const order = (id: number, email: string, createdAt: Date, extra: Partial<PendingOrder> = {}): PendingOrder => ({
  id,
  email,
  tariffKey: "standard_year",
  points: 1,
  amountRub: 23880,
  description: "Стандарт — за год",
  createdAt,
  ...extra,
});
const empty = { now, paidAfter: new Map<string, Date>(), remindedEmails: new Set<string>(), suppressed: new Set<string>() };

describe("брошенные заказы", () => {
  it("окно 1–72 часа, одно письмо на почту — по самому свежему заказу", () => {
    const picked = pickAbandonedOrders(
      [
        order(1, "a@x.ru", hoursAgo(0.5)),
        order(2, "b@x.ru", hoursAgo(2)),
        order(3, "B@x.ru", hoursAgo(5)),
        order(4, "c@x.ru", hoursAgo(73)),
      ],
      empty,
    );
    assert.deepEqual(picked.map((o) => o.id), [2]);
  });

  it("не пишем: оплатил позже, уже писали, в стоп-листе", () => {
    const orders = [order(1, "paid@x.ru", hoursAgo(3)), order(2, "told@x.ru", hoursAgo(3)), order(3, "stop@x.ru", hoursAgo(3)), order(4, "old@x.ru", hoursAgo(3))];
    const picked = pickAbandonedOrders(orders, {
      now,
      paidAfter: new Map([
        ["paid@x.ru", hoursAgo(1)],
        ["old@x.ru", hoursAgo(10)],
      ]),
      remindedEmails: new Set(["told@x.ru"]),
      suppressed: new Set(["stop@x.ru"]),
    });
    // Оплата до заказа (old) не мешает: письмо про новый заказ уходит.
    assert.deepEqual(picked.map((o) => o.id), [4]);
  });

  it("письмо: тот же тариф и точки, счёт по ИНН, телефон, всё экранировано", () => {
    assert.equal(continueOrderPath({ tariffKey: "premium_month", points: 3 }), "/order?plan=premium&cycle=month&points=3");
    assert.equal(continueOrderPath({ tariffKey: "legacy", points: null }, "#invoice"), "/order?plan=standard&cycle=year&points=1#invoice");
    const raw = composeAbandonedOrderEmail(order(7, "a@x.ru", hoursAgo(2), { description: "Премиум <за год>", amountRub: 47880, tariffKey: "premium_year", points: 2 }), "https://wesetup.ru");
    // Разряды суммы — неразрывным пробелом (так пишет ru-RU), сравниваем обычным.
    const mail = { ...raw, html: raw.html.replace(/[\u00a0\u202f]/g, " ") };
    assert.equal(mail.subject, "Оплата WeSetup не завершена");
    assert.match(mail.html, /«Премиум &lt;за год&gt;» на 47 880 ₽/);
    assert.match(mail.html, /href="https:\/\/wesetup\.ru\/order\?plan=premium&cycle=year&points=2"/);
    assert.match(mail.html, /points=2#invoice"/);
    assert.ok(mail.html.includes(CONTACT_PHONE.display));
    assert.equal((mail.html.match(/<p style=/g) ?? []).length, 3);
    // Реквизиты WeSetup для счёта не заполнены — строки про счёт нет.
    const noInvoice = composeAbandonedOrderEmail(order(8, "b@x.ru", hoursAgo(2)), "https://wesetup.ru", { invoice: false });
    assert.doesNotMatch(noInvoice.html, /#invoice|по ИНН/);
    assert.match(noInvoice.html, /Продолжить оплату/);
  });

  it("счёт гостю — только при заполненных реквизитах WeSetup, как в кабинете", () => {
    const page = read("src/app/order/page.tsx");
    assert.match(page, /const guestInvoiceReady = !sessionEmail && invoiceRequisitesReady\(await readPlatformRequisites\(\)\);/);
    const client = read("src/app/order/order-client.tsx");
    assert.match(client, /\{guestInvoiceReady && plan && amountAfterPromo > 0 \? \(/);
    assert.match(client, /href=\{guestInvoice && order\?\.tariffKey \? continueOrderPath/);
    assert.match(read("src/lib/abandoned-orders.server.ts"), /composeAbandonedOrderEmail\(order, appUrl, \{ invoice \}\)/);
  });

  it("крон: каждый час из weekly-digest, отметка после отправки, цели Метрики на оплату", () => {
    const route = read("src/app/api/cron/weekly-digest/route.ts");
    assert.match(route, /await runAbandonedOrderReminders\(\{ now \}\)/);
    assert.match(route, /sendFunnelDigest\(\{ now, force: funnelDigestForce, appUrl: baseUrl \}\)/);
    const server = read("src/lib/abandoned-orders.server.ts");
    assert.match(server, /paymentMethod: "card"/);
    assert.match(server, /if \(!delivered\) \{\s*report\.skipped \+= 1;\s*continue;\s*\}\s*await db\.auditLog/);
    assert.equal(ABANDONED_ACTION, "payment.abandoned.reminded");
    const client = read("src/app/order/order-client.tsx");
    assert.match(client, /ymGoal\(PAYMENT_GOALS\.start/);
    assert.equal((client.match(/reportPaymentSuccess\(data\)/g) ?? []).length, 2);
    assert.match(read("src/app/order/guest-invoice-panel.tsx"), /ymGoal\(PAYMENT_GOALS\.invoice/);
    assert.deepEqual(PAYMENT_GOALS, { start: "order_start", success: "payment_success", invoice: "invoice_request" });
  });
});

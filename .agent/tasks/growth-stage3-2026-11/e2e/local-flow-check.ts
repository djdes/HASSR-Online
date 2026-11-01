/**
 * Локальный стенд (http://localhost:3021, база wesetup_e2e) — сквозная
 * проверка серверной части этапа 3 на настоящей базе:
 *   AC6  слоты показа → запись → то же время второй раз = 409 → время ушло из списка;
 *   AC3a счёт гостю: плохой ИНН = 400, без ключа DaData и названия = name-required,
 *        с названием — счёт, повтор — тот же счёт, PDF по подписи, без подписи — 404;
 *   AC3b брошенный заказ: письмо уходит один раз (второй прогон — нет);
 *   AC2  сводка воронки собирается запросами к базе (чат админа локально не настроен);
 *   AC7  без входа /root/invoices — 404, новые страницы — 200.
 * Письма «доставляются» в локальный приёмник SMTP (e2e/smtp-sink.cjs) — без
 * него отправка в dev считается недоставленной и отметка не ставится.
 * Печатает JSON-итог. Запуск (приёмник уже запущен):
 *   SMTP_HOST=127.0.0.1 SMTP_PORT=2525 npx tsx --env-file=.env .agent/tasks/growth-stage3-2026-11/e2e/local-flow-check.ts
 */
import assert from "node:assert/strict";

import { PDFDocument } from "pdf-lib";

import { ABANDONED_ACTION } from "@/lib/abandoned-orders";
import { runAbandonedOrderReminders } from "@/lib/abandoned-orders.server";
import { db } from "@/lib/db";
import { sendFunnelDigest } from "@/lib/funnel-digest.server";
import { platformOrgId } from "@/lib/partners/partner-hint";

const BASE = process.env.E2E_BASE ?? "http://localhost:3021";
const TAG = "stage3-e2e";
const INN = "5018215599";
const GUEST_EMAIL = `${TAG}-buyer@example.test`;
const ABANDONED_EMAIL = `${TAG}-abandoned@example.test`;
const report: Record<string, unknown> = {};

// Свой адрес для лимитов заявок (3 за 10 минут), чтобы не делить их с ui-check.cjs.
const FORWARDED_FOR = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
const post = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": FORWARDED_FOR },
    body: JSON.stringify(body),
  });
const json = async (response: Response) => (await response.json().catch(() => null)) as Record<string, unknown> | null;

async function cleanup() {
  await db.serviceRequest.deleteMany({ where: { contactName: { startsWith: TAG } } });
  await db.paymentOrder.deleteMany({ where: { email: { in: [GUEST_EMAIL, ABANDONED_EMAIL] } } });
  await db.auditLog.deleteMany({ where: { organizationId: platformOrgId(), action: ABANDONED_ACTION, details: { path: ["email"], equals: ABANDONED_EMAIL } } });
}

async function pages() {
  const checks: Record<string, number> = {};
  for (const path of ["/sanpin-2-3-2-4-4282-26", "/partners", "/order?plan=standard&cycle=month&points=1", "/sitemap.xml"]) {
    const response = await fetch(`${BASE}${path}`);
    checks[path] = response.status;
    // React разделяет подставленные значения и текст комментарием <!-- -->.
    const body = (await response.text()).replace(/<!-- -->/g, "");
    if (path.startsWith("/sanpin")) {
      assert.match(body, /СанПиН 2\.3\/2\.4\.4282-26: что нужно знать общепиту/);
      assert.match(body, /"@type":"FAQPage"/);
    }
    if (path === "/partners") assert.match(body, /id="calculator"/);
    if (path === "/sitemap.xml") assert.match(body, /\/sanpin-2-3-2-4-4282-26</);
  }
  const root = await fetch(`${BASE}/root/invoices`, { redirect: "manual" });
  checks["/root/invoices (без входа)"] = root.status;
  assert.equal(root.status, 404);
  report.pages = checks;
}

async function demoBooking() {
  const slotsResponse = await fetch(`${BASE}/api/demo-request/slots`);
  assert.equal(slotsResponse.status, 200);
  assert.match(slotsResponse.headers.get("cache-control") ?? "", /no-store/);
  const slots = (await json(slotsResponse)) as { timeZone: string; days: Array<{ key: string; slots: string[] }> };
  assert.equal(slots.timeZone, "Europe/Moscow");
  assert.equal(slots.days.length, 5);
  const slot = slots.days.find((day) => day.slots.length > 0)!.slots[0];

  const request = { name: `${TAG} Анна`, phone: "+7 999 111-22-33", slot, email: "anna@example.test", place: "e2e", consent: true, website: "" };
  const first = await post("/api/demo-request", request);
  const firstBody = await json(first);
  assert.equal(first.status, 200, JSON.stringify(firstBody));
  assert.equal(firstBody?.slot, slot);
  const second = await post("/api/demo-request", { ...request, name: `${TAG} Борис` });
  const secondBody = await json(second);
  assert.equal(second.status, 409);
  assert.equal(secondBody?.code, "slot-taken");
  const after = (await json(await fetch(`${BASE}/api/demo-request/slots`))) as typeof slots;
  assert.equal(after.days.some((day) => day.slots.includes(slot)), false);
  const saved = await db.serviceRequest.findMany({
    where: { contactName: { startsWith: TAG } },
    select: { contactName: true, contactEmail: true, scheduledAt: true, comment: true },
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].scheduledAt?.toISOString(), slot);
  report.demo = {
    slot,
    firstStatus: first.status,
    secondStatus: second.status,
    secondCode: secondBody?.code,
    slotHiddenAfterBooking: true,
    saved: saved.map((row) => ({ ...row, scheduledAt: row.scheduledAt?.toISOString() })),
  };
}

async function guestInvoice() {
  const order = { email: GUEST_EMAIL, plan: "standard", cycle: "month", points: 1 };
  const badInn = await post("/api/payments/invoice/guest", { ...order, inn: "1234567890" });
  assert.equal(badInn.status, 400);
  const noName = await post("/api/payments/invoice/guest", { ...order, inn: INN });
  const noNameBody = await json(noName);
  assert.equal(noName.status, 400);
  assert.equal(noNameBody?.code, "name-required");
  // Почта уже зарегистрирована — счёт выставляется из кабинета.
  const account = await post("/api/payments/invoice/guest", { ...order, email: "stage3-e2e-manager@example.test", inn: INN, companyName: "ООО «Проверка»" });
  const accountBody = await json(account);
  assert.equal(account.status, 409, JSON.stringify(accountBody));
  const created = await post("/api/payments/invoice/guest", { ...order, inn: INN, companyName: "ООО «Проверка»" });
  const createdBody = await json(created);
  assert.equal(created.status, 200, JSON.stringify(createdBody));
  assert.equal(createdBody?.created, true);
  const again = await json(await post("/api/payments/invoice/guest", { ...order, inn: INN, companyName: "ООО «Проверка»" }));
  assert.equal(again?.orderId, createdBody?.orderId);
  assert.equal(again?.created, false);

  const pdfUrl = String(createdBody?.pdfUrl);
  const pdf = await fetch(`${BASE}${pdfUrl}`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  const pages = (await PDFDocument.load(bytes)).getPageCount();
  const unsigned = await fetch(`${BASE}${pdfUrl.replace(/sig=[^&]+/, "sig=wrong")}`);
  assert.equal(unsigned.status, 404);

  const row = await db.paymentOrder.findUniqueOrThrow({
    where: { id: Number(createdBody?.orderId) },
    select: { organizationId: true, paymentMethod: true, status: true, amountRub: true, invoiceDueAt: true, buyerJson: true, tariffKey: true },
  });
  assert.equal(row.organizationId, null);
  assert.equal(row.paymentMethod, "invoice");
  assert.equal((row.buyerJson as { inn?: string }).inn, INN);
  report.guestInvoice = {
    badInnStatus: badInn.status,
    noNameStatus: noName.status,
    noNameCode: noNameBody?.code,
    existingAccount: { status: account.status, error: accountBody?.error },
    created: { status: created.status, orderId: createdBody?.orderId, amountRub: createdBody?.amountRub, buyerName: createdBody?.buyerName },
    repeatReusesOrder: true,
    pdf: { status: pdf.status, bytes: bytes.length, pages, startsWith: Buffer.from(bytes.slice(0, 5)).toString() },
    wrongSignatureStatus: unsigned.status,
    row: { ...row, amountRub: Number(row.amountRub), invoiceDueAt: row.invoiceDueAt?.toISOString() },
  };
}

async function abandonedOrders() {
  const now = new Date();
  await db.paymentOrder.create({
    data: {
      email: ABANDONED_EMAIL,
      tariffKey: "standard_month",
      amountRub: 3000,
      description: "Стандарт, месяц",
      status: "pending",
      paymentMethod: "card",
      points: 1,
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    },
  });
  const dry = await runAbandonedOrderReminders({ now, dryRun: true });
  const first = await runAbandonedOrderReminders({ now });
  const second = await runAbandonedOrderReminders({ now });
  const marks = await db.auditLog.count({
    where: { organizationId: platformOrgId(), action: ABANDONED_ACTION, details: { path: ["email"], equals: ABANDONED_EMAIL } },
  });
  assert.ok(first.sent >= 1, JSON.stringify(first));
  assert.equal(marks, 1);
  report.abandoned = { dry, first, second, auditMarks: marks };
}

async function funnelDigest() {
  // Чат админа локально не настроен — проверяем, что запросы к базе проходят и отправка честно «не ушла».
  const result = await sendFunnelDigest({ force: true });
  assert.equal(result.sent, false);
  assert.equal(result.reason, "send-failed");
  report.funnelDigest = result;
}

async function main() {
  await cleanup();
  await pages();
  await demoBooking();
  await guestInvoice();
  await abandonedOrders();
  await funnelDigest();
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), base: BASE, ...report }, null, 2));
  if (!process.argv.includes("--keep")) await cleanup();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

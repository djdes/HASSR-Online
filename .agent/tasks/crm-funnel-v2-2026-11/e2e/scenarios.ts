/**
 * Сценарии продажника на локальной БД после run.ts: спец-КП в пределах лимита и
 * сверх него, согласование (свою — нельзя, больше запрошенного — нельзя),
 * «Отправить КП» строго на согласованные условия, двойная отправка, точки
 * меньше, чем в работе, закрытие задачи с итогом и следующим шагом, оплата →
 * задачи закрыты, сделка «Оплачено», автосчёт не держит автопереход.
 *
 *   SMTP_HOST=127.0.0.1 SMTP_PORT=2526 npx tsx .agent/tasks/crm-funnel-v2-2026-11/e2e/scenarios.ts
 */
import "dotenv/config";

import assert from "node:assert/strict";

import { hasPendingInvoice } from "../../../../src/lib/billing.server";
import { closeCrmTask, closeLifecycleTasksOnPayment, decideDiscount } from "../../../../src/lib/crm/tasks.server";
import { db } from "../../../../src/lib/db";
import { runLifecycleJob } from "../../../../src/lib/lifecycle/job.server";
import { offerDefaults, sendSpecialOffer } from "../../../../src/lib/lifecycle/offers.server";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) {
  console.error("scenarios: only for a local database");
  process.exit(1);
}

const results: { name: string; ok: boolean; detail: string }[] = [];
async function check(name: string, run: () => Promise<string>) {
  try {
    results.push({ name, ok: true, detail: await run() });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, pattern);
    return `отказ: ${message}`;
  }
  throw new Error(`ожидали отказ ${pattern}`);
}

async function main() {
  const user = async (email: string) => db.user.findUniqueOrThrow({ where: { email }, select: { id: true, name: true, organizationId: true } });
  const owner = await user("owner@wesetup.local.test");
  const alexey = await user("alexey@wesetup.ru");
  const sales = await user("sales@wesetup.local.test");
  const actor = (u: { id: string; name: string; organizationId: string }, extra: { superadmin?: boolean; own?: boolean } = {}) => ({ id: u.id, name: u.name, organizationId: u.organizationId, superadmin: extra.superadmin ?? false, own: extra.own ?? false });
  const offer = (org: string, patch: Record<string, unknown> = {}) => ({ organizationId: org, tier: "standard" as const, cycle: "year" as const, points: 2, discountPercent: 10, lifetime: false, validDays: 7, attachInvoice: true, toEmail: `owner@${org}.ru`, note: "", taskId: null, ...patch });

  await check("КП в пределах лимита менеджера (10 %) — сразу: код, счёт, сделка «Сообщение отправлено»", async () => {
    const result = await sendSpecialOffer(offer("lc-romashka"), actor(sales));
    assert.equal(result.status, "sent");
    assert.ok(result.status === "sent" && result.code);
    const deal = await db.crmDeal.findFirstOrThrow({ where: { organizationId: "lc-romashka" } });
    assert.equal(deal.stage, "message_sent");
    return `код ${result.status === "sent" ? result.code : "—"}, счёт ${result.status === "sent" ? result.invoiceId : "—"}`;
  });

  await check("Повторное КП той же организации сразу — 409", () => rejects(sendSpecialOffer(offer("lc-romashka"), actor(sales)), /только что отправлено/));

  await check("КП на меньшее число точек, чем в работе, — отказ", () => rejects(sendSpecialOffer(offer("lc-stolovaya", { points: 1 }), actor(sales)), /в работе 3 точ/));

  let approvalId = "";
  await check("КП 20 % от менеджера (лимит 10 %) — на согласование коммерческому директору", async () => {
    const result = await sendSpecialOffer(offer("lc-stolovaya", { points: 3, discountPercent: 20 }), actor(sales));
    assert.equal(result.status, "approval");
    approvalId = result.status === "approval" ? result.taskId : "";
    const task = await db.crmTask.findUniqueOrThrow({ where: { id: approvalId } });
    assert.equal(task.assigneeId, alexey.id);
    return `согласует ${result.status === "approval" ? result.approverName : "—"}`;
  });

  await check("Свою заявку менеджер согласовать не может", () => rejects(decideDiscount(approvalId, { ...actor(sales) }, { approve: true, percent: 20, comment: null }), /Решает тот|Свою заявку/));
  await check("Согласовать больше запрошенного нельзя", () => rejects(decideDiscount(approvalId, actor(alexey), { approve: true, percent: 25, comment: null }), /Запрошено 20 %/));

  let offerTaskId = "";
  await check("Директор согласует 15 % — у менеджера задача «Отправить КП» на те же условия", async () => {
    const decided = await decideDiscount(approvalId, actor(alexey), { approve: true, percent: 15, comment: "15 хватит" });
    assert.ok(decided.offerTaskId);
    offerTaskId = decided.offerTaskId!;
    const task = await db.crmTask.findUniqueOrThrow({ where: { id: offerTaskId } });
    assert.equal(task.kind, "offer");
    assert.equal(task.assigneeId, sales.id);
    assert.equal(task.discountPercent, 15);
    return task.title;
  });
  await check("Повторное решение по тому же согласованию — 409", () => rejects(decideDiscount(approvalId, actor(owner, { superadmin: true }), { approve: false, percent: null, comment: null }), /уже принято/));
  await check("Из задачи «Отправить КП» другие условия — отказ", () => rejects(sendSpecialOffer(offer("lc-stolovaya", { points: 3, discountPercent: 15, cycle: "month", taskId: offerTaskId }), actor(sales)), /Согласовано на «Стандарт», 3 точ\., за год/));
  await check("Чужую задачу «Отправить КП» не отправить", () => rejects(sendSpecialOffer(offer("lc-stolovaya", { points: 3, discountPercent: 15, taskId: offerTaskId }), actor(alexey)), /тот, кто просил/));
  await check("Отправить КП на согласованных условиях — уходит, задача закрыта; «на все продления» из запроса не проходит", async () => {
    const result = await sendSpecialOffer(offer("lc-stolovaya", { points: 3, discountPercent: 15, taskId: offerTaskId, lifetime: true, validDays: 60 }), actor(sales));
    assert.equal(result.status, "sent");
    const task = await db.crmTask.findUniqueOrThrow({ where: { id: offerTaskId } });
    assert.equal(task.status, "done");
    const promo = await db.promoCode.findFirstOrThrow({ where: { code: result.status === "sent" ? result.code! : "" } });
    assert.equal(promo.lifetime, false);
    assert.ok(promo.endsAt && promo.endsAt.getTime() < Date.now() + 8 * 24 * 3_600_000);
    const active = await db.promoCode.count({ where: { campaignId: "crm-org:lc-stolovaya", active: true } });
    assert.equal(active, 1);
    return `код ${result.status === "sent" ? result.code : "—"}: lifetime=false, срок ≤ 7 дней, активный код один`;
  });

  await check("Свой неоплаченный счёт клиента КП не закрывает", async () => {
    const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@lc-vtoroe.ru" }, select: { id: true } });
    const own = await db.paymentOrder.create({
      data: { email: "owner@lc-vtoroe.ru", tariffKey: "standard_year", amountRub: 23880, description: "«Стандарт» за год (счёт клиента)", status: "pending", organizationId: "lc-vtoroe", userId: owner.id, paymentMethod: "invoice", invoiceDueAt: new Date(Date.now() + 5 * 24 * 3_600_000), points: 1, changeKind: "new" },
    });
    const result = await sendSpecialOffer(offer("lc-vtoroe", { points: 1, discountPercent: 10 }), actor(alexey));
    assert.equal(result.status, "sent");
    assert.match(result.status === "sent" ? (result.invoiceError ?? "") : "", /уже есть неоплаченный счёт/);
    const after = await db.paymentOrder.findUniqueOrThrow({ where: { id: own.id } });
    assert.equal(after.status, "pending");
    assert.equal(await hasPendingInvoice(["lc-vtoroe"]), true);
    return "счёт клиента остался, новый не выставлен";
  });

  await check("Охват «свои»: форма КП по чужому клиенту не открывается", async () => {
    await db.organization.update({ where: { id: "lc-quiet" }, data: { accountManagerId: alexey.id } });
    const own = await offerDefaults("lc-quiet", actor(sales, { own: true }), null);
    assert.equal(own, null);
    const mine = await offerDefaults("lc-stolovaya", actor(sales, { own: true }), null);
    assert.ok(mine);
    return "чужой — null, свой — форма";
  });

  await check("Звонок закрыт «Обещали оплатить» со следующим шагом — сделка «Был прозвон», задача «Перезвонить»", async () => {
    const call = await db.crmTask.findFirstOrThrow({ where: { organizationId: "lc-vtoroe", kind: "call", status: "open" } });
    const next = new Date(Date.now() + 26 * 3_600_000);
    const closed = await closeCrmTask(call.id, actor(alexey), { status: "done", result: "Директор согласует в пятницу", outcome: "promised", nextDueAt: next });
    assert.ok(closed.followUpId);
    const deal = await db.crmDeal.findFirstOrThrow({ where: { organizationId: "lc-vtoroe" } });
    assert.equal(deal.stage, "called");
    const follow = await db.crmTask.findUniqueOrThrow({ where: { id: closed.followUpId! } });
    assert.match(follow.title, /^Перезвонить: /);
    assert.ok(follow.dedupeKey?.startsWith("lc:followup:"));
    return follow.title;
  });
  await check("«Просили перезвонить» без даты — отказ", async () => {
    const call = await db.crmTask.findFirstOrThrow({ where: { organizationId: "lc-solo", kind: "call", status: "open" } });
    return rejects(closeCrmTask(call.id, actor(alexey), { status: "done", result: null, outcome: "callback", nextDueAt: null }), /Когда перезвонить/);
  });
  await check("Охват «свои»: чужую задачу менеджер не закроет", async () => {
    const call = await db.crmTask.findFirstOrThrow({ where: { organizationId: "lc-solo", kind: "call", status: "open" } });
    return rejects(closeCrmTask(call.id, actor(sales, { own: true }), { status: "done", result: null, outcome: "reached", nextDueAt: null }), /не найдена/);
  });
  await check("Отказ после звонка — сделка «Отказ» с причиной", async () => {
    const task = await db.crmTask.findFirstOrThrow({ where: { organizationId: "lc-lost", status: "open" } });
    await closeCrmTask(task.id, actor(alexey), { status: "done", result: "Дорого, ведут на бумаге", outcome: "declined", nextDueAt: null });
    const deal = await db.crmDeal.findFirstOrThrow({ where: { organizationId: "lc-lost" } });
    assert.equal(deal.stage, "lost");
    assert.equal(deal.lostReason, "Дорого, ведут на бумаге");
    return "сделка в «Отказ»";
  });

  await check("Счёт сценария не держит автопереход, но сценарий его видит", async () => {
    const decision = await hasPendingInvoice(["lc-grace"]);
    const own = await hasPendingInvoice(["lc-grace"], new Date(), { includeAutomatic: true });
    assert.equal(decision, false);
    assert.equal(own, true);
    return "hasPendingInvoice: клиент — нет, сценарий — да";
  });

  await check("Оплата — задачи сценария закрыты, сделка «Оплачено»", async () => {
    const closed = await closeLifecycleTasksOnPayment(["lc-paid"]);
    assert.ok(closed >= 1);
    const open = await db.crmTask.count({ where: { organizationId: "lc-paid", status: { in: ["open", "waiting"] } } });
    assert.equal(open, 0);
    const deal = await db.crmDeal.findFirstOrThrow({ where: { organizationId: "lc-paid" } });
    assert.equal(deal.stage, "won");
    return `закрыто задач: ${closed}`;
  });

  await check("Повторный прогон сценария не отменяет перезвон, назначенный менеджером", async () => {
    await runLifecycleJob();
    const follow = await db.crmTask.findFirstOrThrow({ where: { organizationId: "lc-vtoroe", dedupeKey: { startsWith: "lc:followup:" } } });
    assert.equal(follow.status, "open");
    return follow.title;
  });

  await check("Закрытая сделка «Оплачено» не получает причину отказа от задачи", async () => {
    const deal = await db.crmDeal.findFirstOrThrow({ where: { organizationId: "lc-paid" } });
    const task = await db.crmTask.create({ data: { kind: "manual", title: "Уточнить реквизиты", organizationId: "lc-paid", dealId: deal.id, assigneeId: alexey.id, dueAt: new Date() } });
    await closeCrmTask(task.id, actor(alexey), { status: "done", result: "Передумали", outcome: "declined", nextDueAt: null });
    const after = await db.crmDeal.findUniqueOrThrow({ where: { id: deal.id } });
    assert.equal(after.stage, "won");
    assert.equal(after.lostReason, null);
    return "сделка осталась «Оплачено»";
  });

  for (const row of results) console.log(`${row.ok ? "PASS" : "FAIL"} ${row.name} — ${row.detail}`);
  console.log(`${results.filter((row) => row.ok).length}/${results.length} passed`);
  if (results.some((row) => !row.ok)) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });

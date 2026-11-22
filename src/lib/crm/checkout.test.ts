import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CHECKOUT_ABANDON_AFTER_MS,
  CHECKOUT_ABANDON_GIVE_UP_MS,
  checkoutContinuePath,
  checkoutTaskKey,
  checkoutVisitKey,
  composeAbandonedCheckout,
  composeOnboardingTask,
  decideAbandonedCheckout,
  mapCheckoutOrder,
  mapCheckoutVisit,
  mapPaidOrder,
  needsOnboardingTask,
  onboardingTaskKey,
  type CheckoutCandidate,
} from "@/lib/crm/checkout";
import { CRM_CHANNEL_LABELS } from "@/lib/crm/constants";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const APP = "https://wesetup.ru";
const now = new Date("2026-11-22T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
// Разряды суммы — неразрывным пробелом (так пишет ru-RU), сравниваем обычным.
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("запись оформления (AC6)", () => {
  it("одна запись на почту в сутки по Москве, регистр почты не важен", () => {
    assert.equal(checkoutVisitKey("Ivan@Mail.RU", now), checkoutVisitKey("ivan@mail.ru", minutesAgo(60)));
    // 21:30 UTC — уже следующие сутки по Москве.
    assert.equal(checkoutVisitKey("a@b.ru", new Date("2026-11-22T21:30:00Z")), "checkout:visit:a@b.ru:2026-11-23");
    assert.equal(checkoutTaskKey("int1"), "checkout:abandoned:int1");
    assert.equal(onboardingTaskKey(42), "paid:onboarding:42");
  });

  it("событие ленты: тариф, сумма, абсолютная ссылка «продолжить»; служебная почта и пополнение — мимо", () => {
    const item = mapCheckoutVisit({ email: "Ivan@Mail.ru", tariffKey: "premium_year", points: 2, amountRub: 95760, at: now, source: "page", organizationId: "org1" }, APP);
    assert.ok(item);
    assert.equal(item.channel, "checkout");
    assert.equal(item.direction, "event");
    assert.equal(item.externalKey, "checkout:visit:ivan@mail.ru:2026-11-22");
    assert.equal(item.subject, "Открыл(а) оформление оплаты");
    assert.equal(item.href, null);
    assert.equal(item.identity.email, "ivan@mail.ru");
    assert.equal(item.identity.organizationId, "org1");
    assert.match(plain(item.body), /Тариф: Премиум — за год, 2 точки — 95 760 ₽/);
    assert.match(item.body, /Продолжить оплату: https:\/\/wesetup\.ru\/order\?plan=premium&cycle=year&points=2/);
    assert.equal(mapCheckoutVisit({ email: "staff-1@wesetup.local", tariffKey: "premium_year", points: 1, amountRub: 1, at: now, source: "page" }, APP), null);
    assert.equal(mapCheckoutVisit({ email: "a@b.ru", tariffKey: "balance_topup", points: 1, amountRub: 1, at: now, source: "guest" }, APP), null);
    const order = mapCheckoutOrder({ id: 7, email: "a@b.ru", tariffKey: "standard_month", points: null, amountRub: 1990, createdAt: now, organizationId: null, userId: null }, APP);
    assert.ok(order);
    assert.equal(order.subject, "Перешёл(ла) к оплате картой");
    assert.match(order.body, /Заказ № 7/);
    assert.equal(order.externalKey, checkoutVisitKey("a@b.ru", now), "заказ и заход на страницу — один ключ дня");
    assert.equal(checkoutContinuePath("legacy", null), "/order?plan=standard&cycle=year&points=1");
  });
});

describe("незавершённая оплата: когда звать менеджера (AC7)", () => {
  const base: CheckoutCandidate = { occurredAt: minutesAgo(45), contactStage: "new", hasOpenTask: false, orders: [] };

  it("полчаса без оплаты — открыл страницу; был заказ картой — нажал «Перейти к оплате»", () => {
    assert.deepEqual(decideAbandonedCheckout(base, now), { action: "alert", step: "opened" });
    const started = { ...base, orders: [{ status: "pending", paymentMethod: "card", createdAt: minutesAgo(40) }] };
    assert.deepEqual(decideAbandonedCheckout(started, now), { action: "alert", step: "payment_started" });
  });

  it("рано, поздно, оплатил, выставил счёт, спам, уже есть задача — пропуск", () => {
    assert.deepEqual(decideAbandonedCheckout({ ...base, occurredAt: minutesAgo(29) }, now), { action: "skip", reason: "too_early" });
    assert.deepEqual(decideAbandonedCheckout({ ...base, occurredAt: new Date(now.getTime() - CHECKOUT_ABANDON_GIVE_UP_MS - 1) }, now), {
      action: "skip",
      reason: "too_old",
    });
    assert.deepEqual(
      decideAbandonedCheckout({ ...base, orders: [{ status: "paid", paymentMethod: "card", createdAt: minutesAgo(35) }] }, now),
      { action: "skip", reason: "paid" },
    );
    assert.deepEqual(
      decideAbandonedCheckout({ ...base, orders: [{ status: "pending", paymentMethod: "invoice", createdAt: minutesAgo(35) }] }, now),
      { action: "skip", reason: "invoice" },
    );
    assert.deepEqual(decideAbandonedCheckout({ ...base, contactStage: "spam" }, now), { action: "skip", reason: "spam" });
    assert.deepEqual(decideAbandonedCheckout({ ...base, hasOpenTask: true }, now), { action: "skip", reason: "open_task" });
  });

  it("оплата задолго до начала оформления — не оправдание: звоним", () => {
    const old = { ...base, orders: [{ status: "paid", paymentMethod: "card", createdAt: minutesAgo(60 * 24) }] };
    assert.deepEqual(decideAbandonedCheckout(old, now), { action: "alert", step: "opened" });
    assert.equal(CHECKOUT_ABANDON_AFTER_MS, 30 * 60_000);
  });

  it("задача и Telegram: кто, контакты, тариф, шаг, ссылки; HTML экранирован", () => {
    const draft = composeAbandonedCheckout({
      contact: { name: "Иван", company: "ООО <Ромашка>", email: "ivan@mail.ru", phone: "+7 999 123-45-67" },
      visitBody: "Тариф: Премиум — за год — 47 880 ₽\nПродолжить оплату: https://wesetup.ru/order?plan=premium&cycle=year&points=1",
      step: "payment_started",
      occurredAt: minutesAgo(40),
      now,
      taskUrl: "https://wesetup.ru/root/crm/tasks#t1",
    });
    assert.equal(draft.title, "Незавершённая оплата: ООО <Ромашка>");
    assert.match(draft.note, /40 мин назад, нажал\(а\) «Перейти к оплате», но не оплатил\(а\)/);
    assert.match(draft.note, /Контакты: \+7 999 123-45-67, ivan@mail\.ru/);
    assert.match(draft.telegram, /^🛒 <b>Не завершил\(а\) оплату<\/b>/);
    assert.match(draft.telegram, /Кто: ООО &lt;Ромашка&gt;/);
    assert.match(draft.telegram, /plan=premium&amp;cycle=year/);
    assert.match(draft.telegram, /<a href="https:\/\/wesetup\.ru\/root\/crm\/tasks#t1">Задача в CRM: позвонить<\/a>/);
    const noPhone = composeAbandonedCheckout({ contact: { name: null, company: null, email: "a@b.ru", phone: null }, visitBody: "x", step: "opened", occurredAt: minutesAgo(120), now, taskUrl: null });
    assert.match(noPhone.note, /Телефона нет — напишите на почту/);
    assert.match(noPhone.telegram, /2 ч назад/);
    assert.doesNotMatch(noPhone.telegram, /Задача в CRM/);
  });
});

describe("оплатил — другая задача (AC8)", () => {
  it("созвон по запуску: новая подписка, повышение, переход; не продление, не тест, не пополнение", () => {
    assert.equal(needsOnboardingTask({ isTest: false, tariffKey: "premium_year", changeKind: "new" }, false), true);
    assert.equal(needsOnboardingTask({ isTest: false, tariffKey: "premium_year", changeKind: "upgrade" }, false), true);
    assert.equal(needsOnboardingTask({ isTest: false, tariffKey: "premium_year", changeKind: "switch" }, false), true);
    assert.equal(needsOnboardingTask({ isTest: false, tariffKey: "premium_year", changeKind: "renew" }, false), false);
    assert.equal(needsOnboardingTask({ isTest: false, tariffKey: "premium_year", changeKind: "renew" }, true), true);
    assert.equal(needsOnboardingTask({ isTest: true, tariffKey: "premium_year", changeKind: "new" }, true), false);
    assert.equal(needsOnboardingTask({ isTest: false, tariffKey: "balance_topup", changeKind: null }, true), false);
    const task = composeOnboardingTask({
      contact: { name: "Иван", company: null, email: "ivan@mail.ru", phone: null },
      orderId: 9,
      description: "Тариф «Премиум» за год",
      amountRub: 47880,
      isNewClient: true,
    });
    assert.equal(task.title, "Оплатил: Иван — созвон по запуску");
    assert.match(plain(task.note), /^Новый клиент оплатил: заказ № 9, Тариф «Премиум» за год — 47 880 ₽\./);
  });

  it("событие оплаты в ленте: ключ заказа, сумма и баллы", () => {
    const item = mapPaidOrder({ orderId: 9, email: "Ivan@mail.ru", description: "Премиум", amountRub: 40000, pointsSpent: 7880, organizationId: "org1", userId: null, at: now });
    assert.ok(item);
    assert.equal(item.externalKey, "payment:9");
    assert.equal(item.channel, "payment");
    assert.match(plain(item.body), /Премиум — 40 000 ₽ \+ 7 880 ₽ баллами/);
    assert.equal(mapPaidOrder({ orderId: 1, email: "x", description: "d", amountRub: 1, pointsSpent: 0, organizationId: null, userId: null, at: now }), null);
  });
});

describe("провода (AC6–AC9)", () => {
  it("прогон CRM: незавершённые оплаты после напоминаний, источник «checkout» из заказов картой", () => {
    const cycle = read("src/lib/crm/cycle.server.ts");
    assert.match(cycle, /const checkouts = await step\("незавершённые оплаты", \(\) => runCheckoutFollowups\(now\), null\);/);
    const sources = read("src/lib/crm/sources.server.ts");
    assert.match(sources, /checkout: loader\(/);
    assert.match(sources, /paymentMethod: "card",\s*isTest: false/);
    assert.match(sources, /Date\.now\(\) - CHECKOUT_ABANDON_GIVE_UP_MS/);
    assert.equal(CRM_CHANNEL_LABELS.checkout, "Оформление оплаты");
    assert.equal(CRM_CHANNEL_LABELS.payment, "Оплата");
  });

  it("сервер: рабочие часы, одна задача на запись, Telegram админам с ключом, оплата закрывает задачи", () => {
    const server = read("src/lib/crm/checkout.server.ts");
    assert.match(server, /if \(!isWorkingTime\(now\)\) return report;/);
    assert.match(server, /kind: "checkout",[\s\S]*dedupeKey: key,/);
    assert.match(server, /if \(!task\) \{\s*skip\("done"\);\s*continue;\s*\}/);
    assert.match(server, /notifyPlatformAdmin\(message\.telegram, \{\s*kind: "checkout",\s*dedupeKey: key,\s*email: false,/);
    assert.match(server, /kind: "checkout",\s*status: \{ in: \["open", "waiting"\] \},[\s\S]*data: \{ status: "cancelled", result: "Клиент оплатил"/);
    assert.match(server, /kind: "onboarding",[\s\S]*dedupeKey: onboardingTaskKey\(order\.id\),/);
    const fulfillment = read("src/lib/payment-fulfillment.ts");
    assert.match(fulfillment, /try \{\s*const \{ onCheckoutPaid \} = await import\("@\/lib\/crm\/checkout\.server"\);\s*await onCheckoutPaid\(\{ order, organizationId, organizationIds: accountScope, isNewClient \}\);\s*\} catch/);
  });

  it("страница пишет вошедшего после ответа, гостя — маршрут с проверкой от ботов и лимитом", () => {
    const page = read("src/app/order/page.tsx");
    assert.match(page, /if \(offer && plan && sessionEmail && session\?\.user && !session\.user\.isRoot && !impersonating\) \{/);
    assert.match(page, /after\(async \(\) => \{[\s\S]*source: "page",/);
    const route = read("src/app/api/checkout/track/route.ts");
    assert.match(route, /if \(session\?\.user\) return NextResponse\.json\(\{ ok: true \}\);/);
    assert.match(route, /await verifyGuestOrderChallenge\(body\)/);
    assert.match(route, /checkoutTrackRateLimiter\.consume/);
    assert.match(route, /source: "guest",/);
    assert.match(read("src/app/order/order-client.tsx"), /fetch\("\/api\/checkout\/track"/);
  });

  it("CRM-экран: виды задач подписаны и есть в фильтре", () => {
    const tasks = read("src/lib/crm/tasks.server.ts");
    assert.match(tasks, /checkout: "Незавершённая оплата",/);
    assert.match(tasks, /onboarding: "Оплатил — запуск",/);
    assert.match(read("src/app/root/crm/tasks/page.tsx"), /const KIND_FILTERS = \[[^\]]*"checkout", "onboarding"/);
  });
});

// Проверка денег на настоящей базе — без dev-сервера и браузера (решение владельца 30.09: общий сервер
// перегружен). Один процесс node + tsx, локальная база wesetup_wt_balance.
//
// Запуск (из d:/wt/balance): node --env-file=.env --import tsx .agent/tasks/balance-reviews-topup/e2e/db-flow.ts
//
// Что делает — тот же код, что на сайте:
//   • оплата картой: настоящий обработчик ResultURL (src/app/payment/route.ts, POST) с подписью фиктивным
//     тестовым паролем №2 — как касса; повтор уведомления; два уведомления одновременно;
//   • подписка баллами из пополнения (createOrderWithPoints + completePaidOrder) — второй комиссии нет;
//   • счёт на пополнение → markInvoicePaid (ROOT «Оплата поступила»), повтор — 409;
//   • реферальная награда: пополнение её не запускает, подписка баллами — запускает;
//   • анонимный отзыв: submitReview → approveReview (240), повтор одобрения — no-op, публикация без имени;
//   • предзаполнение формы, УПД на аванс, PDF счёта.
// Боевые ключи не используются: касса — фиктивный тестовый магазин только в env этого процесса.
process.env.ROBOKASSA_IS_TEST = "1";
process.env.ROBOKASSA_MERCHANT_LOGIN = "e2e-fake-shop";
process.env.ROBOKASSA_TEST_PASSWORD1 = "e2e-fake-pass-1";
process.env.ROBOKASSA_TEST_PASSWORD2 = "e2e-fake-pass-2";
process.env.ROBOKASSA_SEND_RECEIPT = "";
delete process.env.PLATFORM_ADMIN_TELEGRAM_CHAT_ID;

import { createHash } from "node:crypto";
import fs from "node:fs";

import { NextRequest } from "next/server";

import { POST as robokassaResult } from "@/app/payment/route";
import { createOrderWithPoints } from "@/lib/balance/checkout";
import { loadBalanceOverview } from "@/lib/balance/overview";
import { approveReview, listPublicReviews, submitReview } from "@/lib/balance/reviews";
import { createTopupCardOrder, loadTopupBlockConfig } from "@/lib/balance/topup";
import { ensureClosingDocument } from "@/lib/closing-documents/service";
import { db } from "@/lib/db";
import { createTopupInvoiceOrder, markInvoicePaid, renderInvoice } from "@/lib/invoices/service";
import { completePaidOrder } from "@/lib/payment-fulfillment";

const OUT = "d:/wt/tmp-balance/raw";
fs.mkdirSync(OUT, { recursive: true });
const results: Array<{ name: string; ok: boolean; details?: unknown }> = [];
function check(name: string, ok: boolean, details?: unknown) {
  results.push({ name, ok, details });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${details === undefined ? "" : " " + JSON.stringify(details)}`);
}

const md5 = (value: string) => createHash("md5").update(value, "utf8").digest("hex");

/** Уведомление кассы на ResultURL — как Робокасса, подпись паролем №2 тестового магазина. */
async function kassaNotifies(invId: number, outSum: string): Promise<{ status: number; body: string }> {
  const body = new URLSearchParams({
    OutSum: outSum,
    InvId: String(invId),
    SignatureValue: md5(`${outSum}:${invId}:e2e-fake-pass-2`),
  });
  const request = new NextRequest("http://localhost/payment", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const response = await robokassaResult(request);
  return { status: response.status, body: (await response.text()).trim() };
}

const balanceOf = async (id: string) =>
  (await db.organization.findUnique({ where: { id }, select: { balanceRub: true } }))?.balanceRub ?? null;
const ledger = (dedupeKey: string) =>
  db.balanceTransaction.findMany({ where: { dedupeKey }, select: { amount: true, kind: true, description: true } });
const accruals = async (paymentOrderId: number) =>
  (
    await db.partnerAccrual.findMany({
      where: { paymentOrderId },
      orderBy: { kind: "asc" },
      select: { kind: true, baseAmountRub: true, amountRub: true },
    })
  ).map((a) => ({ kind: a.kind, base: Number(a.baseAmountRub), amount: Number(a.amountRub) }));

async function main() {
  const run = Date.now().toString(36);
  const sameName = "Алексей Партнёрская программа";

  /* ------------------------------------------------------------------ посев */
  const orgA = await db.organization.create({
    data: {
      name: sameName,
      type: "cafe",
      inn: "7700000017",
      address: "420111, г Казань, ул Баумана, д 1",
    },
  });
  const userA = await db.user.create({
    data: {
      email: `db-owner-${run}@example.com`,
      name: sameName,
      passwordHash: "x",
      role: "manager",
      organizationId: orgA.id,
      journalAccessMigrated: true,
    },
  });
  const orgP = await db.organization.create({ data: { name: "Партнёр db", type: "other" } });
  const userP = await db.user.create({
    data: {
      email: `db-partner-${run}@example.com`,
      name: "Пётр Партнёров",
      passwordHash: "x",
      role: "manager",
      organizationId: orgP.id,
      journalAccessMigrated: true,
    },
  });
  const partner = await db.partner.create({
    data: {
      slug: `db-${run}`,
      code: `D${run}`.toUpperCase().slice(0, 12),
      status: "active",
      type: "consultant",
      companyName: "ИП Партнёров",
      inn: "770000000001",
      city: "Москва",
      phone: "+79990002203",
      contactEmail: userP.email,
      termsAcceptedAt: new Date(),
      applicantUserId: userP.id,
      applicantOrganizationId: orgP.id,
    },
  });
  await db.partnerClient.create({
    data: {
      partnerId: partner.id,
      organizationId: orgA.id,
      accessLevel: "view",
      source: "manual",
      attachedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  });
  // B — приглашённая A по реферальной программе клиент → клиент.
  const orgB = await db.organization.create({
    data: { name: "Кофейня «Зерно»", type: "cafe", referredByOrganizationId: orgA.id, referredAt: new Date() },
  });
  const userB = await db.user.create({
    data: {
      email: `db-ownerb-${run}@example.com`,
      name: "Борис Тестов",
      passwordHash: "x",
      role: "manager",
      organizationId: orgB.id,
      journalAccessMigrated: true,
    },
  });
  await db.platformSetting.upsert({
    where: { key: "legal.requisites" },
    create: {
      key: "legal.requisites",
      value: JSON.stringify({
        nameFull: "ООО «Тестовый исполнитель e2e»",
        nameShort: "ООО «Тест e2e»",
        inn: "7700000000",
        kpp: "770001001",
        ogrn: "1027700000000",
        address: "г. Москва, ул. Тестовая, д. 1, офис 1",
        bank: { name: "Тестовый банк", bik: "044525000", account: "40702810000000000000", corrAccount: "30101810000000000000" },
        head: { post: "Генеральный директор", name: "Тестов Тест Тестович" },
        vatMode: "none",
        email: "billing@example.com",
        phone: "+70000000000",
        facsimileFile: null,
        stampFile: null,
      }),
    },
    update: {},
  });
  const rootId = `root-${run}`;

  /* ------------------------------------------------- 1. форма отзыва: без дублей */
  const overview = await loadBalanceOverview(orgA.id, {
    id: userA.id,
    name: userA.name,
    email: userA.email,
    role: "manager",
    permissionPreset: null,
    isRoot: false,
  });
  check(
    "предзаполнение: имя человека, в «Заведение и город» только город (организация названа как человек)",
    overview.reviewPrefill.authorName === sameName && overview.reviewPrefill.place === "Казань",
    overview.reviewPrefill,
  );

  /* --------------------------------------------- 2. анонимный отзыв: 240, без имени */
  const review = await submitReview({
    organizationId: orgA.id,
    userId: userA.id,
    authorName: sameName,
    place: "Казань",
    anonymous: true,
    text: "Перешли на электронные журналы весной — проверка прошла без замечаний, всё нашли сразу.",
    rating: 5,
    consentPublic: true,
    attachment: null,
  });
  check(
    "анонимный отзыв сохранён без имени и заведения, к начислению 240",
    review.anonymous && review.authorName === "" && review.place === "" && review.suggestedRewardRub === 240,
    { anonymous: review.anonymous, suggested: review.suggestedRewardRub },
  );
  const beforeReview = await balanceOf(orgA.id);
  const approved = await approveReview({ id: review.id, actorUserId: rootId });
  const approvedAgain = await approveReview({ id: review.id, actorUserId: rootId });
  const reviewLedger = await ledger(`review_reward:${review.id}`);
  check(
    "одобрение начисляет 240 ₽ (не 300); повторное одобрение — no-op",
    approved?.rewardRub === 240 && approvedAgain === null && reviewLedger.length === 1 &&
      reviewLedger[0].amount === 240 && (await balanceOf(orgA.id)) === (beforeReview ?? 0) + 240,
    { approved, reviewLedger },
  );
  // ROOT понизил вид до «текст» явно — анонимность всё равно −20 %.
  const review2 = await submitReview({
    organizationId: orgB.id,
    userId: userB.id,
    authorName: "",
    place: "",
    anonymous: true,
    text: "Кофейня ведёт журналы в WeSetup второй месяц, всё понятно даже новым бариста.",
    rating: 5,
    consentPublic: true,
    attachment: null,
  });
  const approved2 = await approveReview({ id: review2.id, kind: "video", actorUserId: rootId });
  check("модератор выбрал «видео» — анонимному начислено 1592 (1990 × 0,8)", approved2?.rewardRub === 1592, approved2);
  const publicReviews = await listPublicReviews();
  const pub = publicReviews.find((r) => r.id === review.id);
  check(
    "на сайте: «Анонимный отзыв» и сфера «Кафе / Кофейня», без имени",
    pub?.author === "Анонимный отзыв" && pub?.place === "Кафе / Кофейня" && pub?.anonymous === true,
    pub,
  );

  /* ------------------------------------------------ 3. пополнение картой: касса */
  const balance0 = (await balanceOf(orgA.id)) ?? 0;
  const card = await createTopupCardOrder({ organizationId: orgA.id, userId: userA.id, email: userA.email, amountRub: 5000 });
  const cardRow = await db.paymentOrder.findUniqueOrThrow({ where: { id: card.id } });
  check(
    "заказ-пополнение: balance_topup, pending, 5000, без промокода и баллов, тестовый режим",
    cardRow.tariffKey === "balance_topup" && cardRow.status === "pending" && Number(cardRow.amountRub) === 5000 &&
      cardRow.promoCode === null && cardRow.pointsSpent === 0 && cardRow.isTest === true,
    { tariffKey: cardRow.tariffKey, status: cardRow.status, amount: Number(cardRow.amountRub) },
  );
  const forged = await kassaNotifies(card.id, "300000.00");
  check("уведомление с чужой суммой (300000.00) — отказ, заказ не оплачен", forged.status === 400 && forged.body === "amount mismatch" &&
    (await db.paymentOrder.findUniqueOrThrow({ where: { id: card.id } })).status === "pending", forged);
  const paid1 = await kassaNotifies(card.id, "5000.00");
  const cardLedger = await ledger(`topup:${card.id}`);
  const balance1 = (await balanceOf(orgA.id)) ?? 0;
  check(
    "ResultURL → OK; +5 000 на баланс сразу, строка «Пополнение баланса картой…»",
    paid1.body === `OK${card.id}` && cardLedger.length === 1 && cardLedger[0].kind === "topup" && cardLedger[0].amount === 5000 &&
      cardLedger[0].description === `Пополнение баланса картой, заказ №${card.id} (тестовый платёж)` && balance1 === balance0 + 5000,
    { paid1, cardLedger, balance0, balance1 },
  );
  const cardAccruals = await accruals(card.id);
  check("партнёру с пополнения: 20 % от 5 000 = 1 000 ₽", JSON.stringify(cardAccruals) === JSON.stringify([{ kind: "subscription", base: 5000, amount: 1000 }]), cardAccruals);
  const paid2 = await kassaNotifies(card.id, "5000.00");
  check(
    "повторное уведомление — OK, но без второго зачисления и второй комиссии",
    paid2.body === `OK${card.id}` && (await ledger(`topup:${card.id}`)).length === 1 && (await balanceOf(orgA.id)) === balance1 &&
      (await accruals(card.id)).length === 1,
    paid2,
  );
  const audit = await db.auditLog.findMany({
    where: { entityId: String(card.id), action: { startsWith: "balance.topup" } },
    select: { action: true, details: true },
  });
  check("аудит balance.topup.paid с суммой", audit.some((a) => a.action === "balance.topup.paid"), audit);
  const notifications = await db.notification.findMany({ where: { organizationId: orgA.id, kind: "balance.topup" }, select: { title: true } });
  check("колокольчик руководству: «Баланс пополнен на 5 000 ₽»", notifications.some((n) => n.title.replace(/[\u00a0\u202f]/g, " ") === "Баланс пополнен на 5 000 ₽"), notifications);
  const closing = await ensureClosingDocument(card.id);
  check("УПД на пополнение не выпускается — причина «advance»", closing.document === null && !closing.eligibility.ok && closing.eligibility.reason === "advance", closing.eligibility);

  // Два уведомления кассы одновременно — одно зачисление.
  const race = await createTopupCardOrder({ organizationId: orgA.id, userId: userA.id, email: userA.email, amountRub: 1990 });
  const both = await Promise.all([kassaNotifies(race.id, "1990.00"), kassaNotifies(race.id, "1990.00")]);
  const balance2 = (await balanceOf(orgA.id)) ?? 0;
  check(
    "два уведомления одновременно — оба OK, зачисление одно (+1 990)",
    both.every((r) => r.body === `OK${race.id}`) && (await ledger(`topup:${race.id}`)).length === 1 && balance2 === balance1 + 1990,
    { both, balance2 },
  );
  const raceAccruals = await accruals(race.id);
  check(
    "второе пополнение (2-й денежный платёж) — 20 % = 398 и бонус 3 000 по правилам computePaymentAccruals, по одной строке",
    JSON.stringify(raceAccruals) === JSON.stringify([
      { kind: "bonus", base: 1990, amount: 3000 },
      { kind: "subscription", base: 1990, amount: 398 },
    ]),
    raceAccruals,
  );

  /* ---------------------------------- 4. подписка баллами из пополнения — без второй комиссии */
  const subscription = await createOrderWithPoints({
    organizationId: orgA.id,
    userId: userA.id,
    email: userA.email,
    tariffKey: "monthly",
    description: "Подписка на 30 дн.",
    grossRub: 1990,
    subscriptionRub: 1990,
    bundleConfig: null,
    isTest: true,
    recurringConsent: false,
    partnerSlug: null,
    referrerOrganizationId: null,
    usePoints: true,
    baseRub: 1990,
  });
  const storedSub = await db.paymentOrder.findUniqueOrThrow({ where: { id: subscription.id } });
  await completePaidOrder(storedSub);
  const subAccruals = await accruals(subscription.id);
  const orgAfterSub = await db.organization.findUniqueOrThrow({ where: { id: orgA.id }, select: { balanceRub: true, subscriptionEnd: true } });
  check(
    "подписка 1 990 ₽ оплачена баллами из пополнения (0 ₽ деньгами): списано 1 990, подписка продлена, партнёру — ничего",
    subscription.paidByPoints && subscription.amountRub === 0 && subscription.pointsSpent === 1990 && subAccruals.length === 0 &&
      orgAfterSub.balanceRub === balance2 - 1990 && orgAfterSub.subscriptionEnd !== null,
    { subscription, subAccruals, balance: orgAfterSub.balanceRub },
  );

  /* -------------------------------------------- 5. счёт на пополнение → «Оплата поступила» */
  const invoice = await createTopupInvoiceOrder({ organizationId: orgA.id, userId: userA.id, email: userA.email, amountRub: 10000 });
  if (!invoice.ok) throw new Error(`invoice: ${invoice.error}`);
  const again = await createTopupInvoiceOrder({ organizationId: orgA.id, userId: userA.id, email: userA.email, amountRub: 10000 });
  const other = await createTopupInvoiceOrder({ organizationId: orgA.id, userId: userA.id, email: userA.email, amountRub: 7000 });
  check(
    "счёт: 10 000, «(счёт)»; повтор с той же суммой — тот же счёт; другая сумма — отказ 409 с номером",
    invoice.created && Number(invoice.order.amountRub) === 10000 && invoice.order.description === "Пополнение баланса на 10 000 ₽ (счёт)" &&
      again.ok && again.order.id === invoice.order.id && !again.created && !other.ok && other.status === 409 &&
      other.error.replace(/[\u00a0\u202f]/g, " ").startsWith(`Уже выставлен счёт № ${invoice.order.id} на 10 000 ₽`),
    { invoice: invoice.order.id, other },
  );
  const block = await loadTopupBlockConfig(orgA.id);
  check("блок пополнения видит действующий счёт", block.pendingInvoice?.id === invoice.order.id && block.cardReady && block.invoiceReady && block.organizationInn === "7700000017", block);
  const pdf = await renderInvoice(invoice.order.id);
  check("PDF счёта на пополнение собирается", Boolean(pdf && pdf.pdf.subarray(0, 4).toString() === "%PDF"), { bytes: pdf?.pdf.length });
  const balance3 = (await balanceOf(orgA.id)) ?? 0;
  const marked = await markInvoicePaid(invoice.order.id, rootId);
  const invoiceLedger = await ledger(`topup:${invoice.order.id}`);
  check(
    "«Оплата поступила»: +10 000, строка «Пополнение баланса по счёту…», автор — ROOT",
    marked.ok && invoiceLedger.length === 1 && invoiceLedger[0].amount === 10000 &&
      invoiceLedger[0].description.startsWith(`Пополнение баланса по счёту, заказ №${invoice.order.id}`) && (await balanceOf(orgA.id)) === balance3 + 10000,
    { invoiceLedger },
  );
  const invoiceAccruals = await accruals(invoice.order.id);
  check(
    "партнёру со счёта на пополнение: 20 % = 2 000; бонус уже был — не повторяется",
    JSON.stringify(invoiceAccruals) === JSON.stringify([{ kind: "subscription", base: 10000, amount: 2000 }]),
    invoiceAccruals,
  );
  const markedAgain = await markInvoicePaid(invoice.order.id, rootId);
  check(
    "повторное «Оплата поступила» — 409, второго зачисления нет",
    !markedAgain.ok && markedAgain.status === 409 && (await ledger(`topup:${invoice.order.id}`)).length === 1,
    markedAgain,
  );
  const totalAccruals = await db.partnerAccrual.count({ where: { organizationId: orgA.id } });
  const totalRub = await db.partnerAccrual.aggregate({ where: { organizationId: orgA.id }, _sum: { amountRub: true } });
  check(
    "у партнёра по A ровно 4 строки: 1 000 + (398 + бонус 3 000) + 2 000; с подписки баллами — ничего",
    totalAccruals === 4 && Number(totalRub._sum.amountRub) === 6398,
    { totalAccruals, totalRub: Number(totalRub._sum.amountRub) },
  );

  /* ----------------------------------------- 6. реферальная награда клиент → клиент */
  const topupB = await createTopupCardOrder({ organizationId: orgB.id, userId: userB.id, email: userB.email, amountRub: 5000 });
  await kassaNotifies(topupB.id, "5000.00");
  const rewardAfterTopup = await ledger(`referral_reward:${orgB.id}`);
  check("пополнение приглашённой организации рекомендателю ничего не начисляет", rewardAfterTopup.length === 0, rewardAfterTopup);
  const subB = await createOrderWithPoints({
    organizationId: orgB.id,
    userId: userB.id,
    email: userB.email,
    tariffKey: "monthly",
    description: "Подписка на 30 дн.",
    grossRub: 1990,
    subscriptionRub: 1990,
    bundleConfig: null,
    isTest: true,
    recurringConsent: false,
    partnerSlug: null,
    referrerOrganizationId: null,
    usePoints: true,
    baseRub: 1990,
  });
  await completePaidOrder(await db.paymentOrder.findUniqueOrThrow({ where: { id: subB.id } }));
  const rewardAfterSub = await ledger(`referral_reward:${orgB.id}`);
  check(
    "подписка приглашённой (баллами из пополнения) — рекомендателю 30 % от 1 990 = 597",
    rewardAfterSub.length === 1 && rewardAfterSub[0].amount === 597 && rewardAfterSub[0].kind === "referral_reward",
    rewardAfterSub,
  );
}

main()
  .then(() => undefined)
  .catch((error) => {
    console.error(error);
    results.push({ name: "fatal", ok: false, details: String(error?.stack ?? error) });
  })
  .finally(async () => {
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    fs.writeFileSync(`${OUT}/db-flow.json`, JSON.stringify({ passed, failed, results }, null, 2));
    console.log(`\n${passed} passed, ${failed} failed`);
    await db.$disconnect().catch(() => undefined);
    process.exit(failed > 0 ? 1 : 0);
  });

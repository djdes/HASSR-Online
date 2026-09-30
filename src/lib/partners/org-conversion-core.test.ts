import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_FREE_PERIOD } from "@/lib/billing-period";

import {
  accountEndAfterLeave,
  carriedBilling,
  formatMskDate,
  isConversionOffered,
  isReturnOffered,
  mergedAccountState,
  pickHomeTarget,
  planConversion,
  planReturn,
  rewardTermsText,
  type ConversionOrder,
  type ConversionSnapshot,
  type ReturnSnapshot,
} from "./org-conversion-core";
import { computePaymentAccruals, DEFAULT_REWARD_RULE } from "./rewards";

// После бесплатного периода (он кончается 11.10.2026): переход на оплату действует.
const NOW = new Date("2026-11-15T09:00:00.000Z");
const IN_FREE_PERIOD = new Date("2026-10-05T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;

function days(n: number, from: Date = NOW): Date {
  return new Date(from.getTime() + n * DAY);
}

type SnapshotPatch = {
  now?: Date;
  actor?: Partial<ConversionSnapshot["actor"]>;
  partner?: Partial<NonNullable<ConversionSnapshot["partner"]>> | null;
  teamInOrganization?: ConversionSnapshot["teamInOrganization"];
  organization?: Partial<ConversionSnapshot["organization"]>;
  account?: Partial<NonNullable<ConversionSnapshot["account"]>> | null;
  activeLink?: ConversionSnapshot["activeLink"];
  orders?: ConversionOrder[];
  settings?: ConversionSnapshot["settings"];
};

/**
 * Базовый случай: владелец аккаунта с тремя организациями (своя «Консалтинг»
 * — домашняя, «Кафе Ромашка» — её переводим, «Бар» — ещё одна), оплачено
 * до 1 декабря, у аккаунта 7 активных, в кафе — 3.
 */
function conversion(patch: SnapshotPatch = {}): ConversionSnapshot {
  const base: ConversionSnapshot = {
    now: NOW,
    actor: { userId: "u-owner", homeOrganizationId: "org-home", inForeignMode: false },
    partner: {
      id: "p-1",
      status: "active",
      brandName: "Консалт Плюс",
      inn: "7701234567",
      applicantOrganizationId: "org-home",
    },
    teamInOrganization: [],
    organization: {
      id: "org-cafe",
      name: "Кафе Ромашка",
      inn: "7709999999",
      isDemo: false,
      kind: "regular",
      isPlatform: false,
      deletionRequested: false,
      accountId: "acc-1",
      subscriptionPlan: "paid",
      subscriptionEnd: null,
      recurringActive: false,
      balanceRub: 0,
      activeUsers: 3,
      actorMemberRole: "owner",
    },
    account: {
      id: "acc-1",
      ownerUserId: "u-owner",
      subscriptionPlan: "paid",
      subscriptionEnd: new Date("2026-12-01T09:00:00.000Z"),
      lifetimeDiscount: null,
      organizations: [
        { id: "org-home", name: "Консалтинг", isDemo: false, kind: "regular", subscriptionEnd: null, createdAt: new Date("2025-01-01"), actorIsOwnerMember: true },
        { id: "org-cafe", name: "Кафе Ромашка", isDemo: false, kind: "regular", subscriptionEnd: null, createdAt: new Date("2025-03-01"), actorIsOwnerMember: true },
        { id: "org-bar", name: "Бар", isDemo: false, kind: "regular", subscriptionEnd: null, createdAt: new Date("2025-05-01"), actorIsOwnerMember: true },
      ],
      activeUsers: 7,
    },
    activeLink: null,
    orders: [],
    rule: DEFAULT_REWARD_RULE,
    settings: DEFAULT_FREE_PERIOD,
  };
  return {
    ...base,
    now: patch.now ?? base.now,
    actor: { ...base.actor, ...patch.actor },
    partner: patch.partner === null ? null : { ...(base.partner as NonNullable<ConversionSnapshot["partner"]>), ...patch.partner },
    teamInOrganization: patch.teamInOrganization ?? base.teamInOrganization,
    organization: { ...base.organization, ...patch.organization },
    account: patch.account === null ? null : { ...(base.account as NonNullable<ConversionSnapshot["account"]>), ...patch.account },
    activeLink: patch.activeLink === undefined ? base.activeLink : patch.activeLink,
    orders: patch.orders ?? base.orders,
    settings: patch.settings ?? base.settings,
  };
}

function order(patch: Partial<ConversionOrder>): ConversionOrder {
  return {
    id: 101,
    status: "pending",
    paymentMethod: "card",
    amountRub: 1990,
    createdAt: new Date(NOW.getTime() - 60 * MIN),
    paidAt: null,
    invoiceDueAt: null,
    ...patch,
  };
}

function blockerCodes(snapshot: ConversionSnapshot): string[] {
  const plan = planConversion(snapshot);
  return plan.ok ? [] : plan.blockers.map((b) => b.code);
}

function okConversion(snapshot: ConversionSnapshot) {
  const plan = planConversion(snapshot);
  assert.equal(plan.ok, true, plan.ok ? "" : JSON.stringify(plan.blockers));
  if (!plan.ok) throw new Error("unreachable");
  return plan;
}

// ------------------------------------------------------------ перевод: базовый путь

test("перевод: организация уходит из аккаунта с тарифом и сроком, привязка — клиент на редактировании", () => {
  const plan = okConversion(conversion());
  assert.deepEqual(plan.ops.organizationBilling, {
    subscriptionPlan: "paid",
    subscriptionEnd: new Date("2026-12-01T09:00:00.000Z"),
  });
  assert.equal(plan.ops.fromAccountId, "acc-1");
  assert.equal(plan.ops.partnerId, "p-1");
  assert.deepEqual(plan.ops.link, { accessLevel: "edit", source: "converted", convertedByUserId: "u-owner" });
  // Своё членство снимается: дальше — через партнёрский кабинет.
  assert.deepEqual(plan.ops.removeMemberUserIds, ["u-owner"]);
  assert.equal(plan.ops.homeMove, null);
  assert.equal(plan.ops.disableRecurring, false);
  // Аккаунт оплачен сам по себе — поднимать срок не нужно.
  assert.equal(plan.ops.accountEndRaiseTo, null);
});

test("перевод: последствия — оплата, места, комиссия, доступ", () => {
  const { consequences } = okConversion(conversion());
  const payment = consequences.payment.join(" ");
  assert.match(payment, /оплачена до 1 декабря 2026/);
  assert.match(payment, /остаётся у организации/);
  assert.match(payment, /Ваш аккаунт сохраняет свою оплату до 1 декабря 2026/);
  assert.match(consequences.seats.join(" "), /было 7, станет 4/);
  const commission = consequences.commission.join(" ");
  assert.match(commission, /20 % от каждой оплаты подписки в течение 12 мес/);
  assert.match(commission, /3\s000 ₽ за 2-ю оплату/);
  assert.match(commission, /до перевода, вознаграждения нет/);
  const access = consequences.access.join(" ");
  assert.match(access, /уйдёт из вашего списка организаций/);
  assert.match(access, /Открыть кабинет/);
  assert.match(access, /нельзя — это делает клиент/);
  assert.match(consequences.next.join(" "), /Передать клиенту/);
});

test("перевод: срок единицы биллинга — максимум аккаунта и зеркал его организаций", () => {
  const later = new Date("2027-01-20T09:00:00.000Z");
  const snapshot = conversion({
    account: {
      organizations: [
        { id: "org-home", name: "Консалтинг", isDemo: false, kind: "regular", subscriptionEnd: later, createdAt: new Date("2025-01-01"), actorIsOwnerMember: true },
        { id: "org-cafe", name: "Кафе Ромашка", isDemo: false, kind: "regular", subscriptionEnd: null, createdAt: new Date("2025-03-01"), actorIsOwnerMember: true },
        // Демо не входит в тариф — его срок не считается.
        { id: "org-demo", name: "Демо", isDemo: true, kind: "regular", subscriptionEnd: new Date("2030-01-01"), createdAt: new Date("2025-06-01"), actorIsOwnerMember: true },
      ],
    },
  });
  assert.deepEqual(carriedBilling(snapshot).subscriptionEnd, later);
});

test("перевод: если оплата держалась на зеркале уходящей организации, срок переносится и на аккаунт", () => {
  const orgEnd = new Date("2027-02-01T09:00:00.000Z");
  const snapshot = conversion({
    organization: { subscriptionEnd: orgEnd },
    account: { subscriptionEnd: null, subscriptionPlan: "paid" },
  });
  assert.deepEqual(accountEndAfterLeave(snapshot), orgEnd);
  const plan = okConversion(snapshot);
  assert.deepEqual(plan.ops.accountEndRaiseTo, orgEnd);
  assert.deepEqual(plan.ops.organizationBilling.subscriptionEnd, orgEnd);
  assert.match(plan.consequences.payment.join(" "), /Ваш аккаунт сохраняет свою оплату до 1 февраля 2027/);
});

test("перевод: срок аккаунта не понижается и не трогается, если он не хуже", () => {
  const snapshot = conversion({ organization: { subscriptionEnd: new Date("2026-11-20T00:00:00.000Z") } });
  assert.equal(accountEndAfterLeave(snapshot), null);
});

test("перевод: приостановленная организация остаётся приостановленной", () => {
  const plan = okConversion(conversion({ organization: { subscriptionPlan: "paused" } }));
  assert.equal(plan.ops.organizationBilling.subscriptionPlan, "paused");
});

test("перевод: действующая подписка с автопродлением — автопродление выключается, срок остаётся", () => {
  const plan = okConversion(conversion({ organization: { recurringActive: true } }));
  assert.equal(plan.ops.disableRecurring, true);
  assert.match(plan.consequences.payment.join(" "), /Автопродление с вашей карты для этой организации выключится/);
  assert.deepEqual(plan.ops.organizationBilling.subscriptionEnd, new Date("2026-12-01T09:00:00.000Z"));
});

test("перевод: скидка навсегда остаётся на аккаунте, к организации не переходит", () => {
  const plan = okConversion(
    conversion({ account: { lifetimeDiscount: { code: "VSEGDA20", kind: "percent", value: 20 } } }),
  );
  assert.match(plan.consequences.payment.join(" "), /скидка навсегда \(VSEGDA20\) остаётся на вашем аккаунте/);
  // В операциях про скидку ничего нет — привязка остаётся на аккаунте как была.
  assert.equal(JSON.stringify(plan.ops).includes("VSEGDA20"), false);
});

test("перевод: баллы остаются у организации", () => {
  const plan = okConversion(conversion({ organization: { balanceRub: 1500 } }));
  assert.match(plan.consequences.payment.join(" "), /Баллы на балансе организации \(1\s500 ₽\) остаются у неё/);
});

test("перевод: неоплаченная организация после бесплатного периода — предупреждение о тарифе на одного", () => {
  const plan = okConversion(
    conversion({
      organization: { subscriptionPlan: "free" },
      account: { subscriptionPlan: "free", subscriptionEnd: null },
    }),
  );
  assert.match(plan.consequences.payment.join(" "), /оплачивает она сама/);
  assert.match(plan.consequences.seats.join(" "), /бесплатный тариф — на 1 сотрудника/);
});

test("перевод: в бесплатный период предупреждения о тарифе нет", () => {
  const plan = okConversion(
    conversion({
      now: IN_FREE_PERIOD,
      organization: { subscriptionPlan: "free" },
      account: { subscriptionPlan: "free", subscriptionEnd: null },
    }),
  );
  assert.doesNotMatch(plan.consequences.seats.join(" "), /бесплатный тариф/);
});

// ------------------------------------------------------------ перевод: заказы

test("перевод: неоплаченный счёт с действующим сроком — отказ", () => {
  const snapshot = conversion({
    orders: [order({ id: 55, paymentMethod: "invoice", invoiceDueAt: days(3), amountRub: 5970 })],
  });
  const plan = planConversion(snapshot);
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.deepEqual(plan.blockers.map((b) => b.code), ["pending_invoice"]);
  assert.match(plan.blockers[0].message, /счёт №55 на 5\s970 ₽/);
});

test("перевод: счёт без срока тоже держит перевод", () => {
  assert.deepEqual(blockerCodes(conversion({ orders: [order({ paymentMethod: "invoice", invoiceDueAt: null })] })), ["pending_invoice"]);
});

test("перевод: просроченный неоплаченный счёт тоже держит перевод (его могут оплатить позже)", () => {
  assert.deepEqual(blockerCodes(conversion({ orders: [order({ paymentMethod: "invoice", invoiceDueAt: days(-1) })] })), ["pending_invoice"]);
});

test("перевод: начатая оплата картой в пределах суток — отказ, старая — нет", () => {
  assert.deepEqual(blockerCodes(conversion({ orders: [order({ createdAt: new Date(NOW.getTime() - 2 * 60 * MIN) })] })), ["pending_card_payment"]);
  assert.deepEqual(blockerCodes(conversion({ orders: [order({ createdAt: new Date(NOW.getTime() - 30 * 60 * MIN) })] })), []);
  assert.deepEqual(blockerCodes(conversion({ orders: [order({ status: "cancelled" })] })), []);
});

test("перевод: оплата за последние 15 минут — отказ с ожиданием, позже — можно", () => {
  const recent = conversion({ orders: [order({ status: "paid", paidAt: new Date(NOW.getTime() - 5 * MIN) })] });
  const plan = planConversion(recent);
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.blockers[0].code, "recent_payment");
  assert.match(plan.blockers[0].message, /через 10 мин/);
  assert.deepEqual(blockerCodes(conversion({ orders: [order({ status: "paid", paidAt: new Date(NOW.getTime() - 20 * MIN) })] })), []);
});

// ------------------------------------------------------------ перевод: домашняя организация

test("перевод домашней организации: профиль переезжает в самую старую свою организацию аккаунта", () => {
  const snapshot = conversion({
    actor: { homeOrganizationId: "org-cafe" },
    account: {
      organizations: [
        { id: "org-cafe", name: "Кафе Ромашка", isDemo: false, kind: "regular", subscriptionEnd: null, createdAt: new Date("2024-01-01"), actorIsOwnerMember: true },
        { id: "org-demo", name: "Демо", isDemo: true, kind: "regular", subscriptionEnd: null, createdAt: new Date("2024-02-01"), actorIsOwnerMember: true },
        { id: "org-master", name: "Справочники", isDemo: false, kind: "directory", subscriptionEnd: null, createdAt: new Date("2024-03-01"), actorIsOwnerMember: true },
        { id: "org-foreign", name: "Чужая", isDemo: false, kind: "regular", subscriptionEnd: null, createdAt: new Date("2024-04-01"), actorIsOwnerMember: false },
        { id: "org-bar", name: "Бар", isDemo: false, kind: "regular", subscriptionEnd: null, createdAt: new Date("2025-05-01"), actorIsOwnerMember: true },
        { id: "org-home", name: "Консалтинг", isDemo: false, kind: "regular", subscriptionEnd: null, createdAt: new Date("2025-01-01"), actorIsOwnerMember: true },
      ],
    },
  });
  assert.deepEqual(pickHomeTarget(snapshot), { toOrganizationId: "org-home", toOrganizationName: "Консалтинг" });
  const plan = okConversion(snapshot);
  assert.deepEqual(plan.ops.homeMove, { toOrganizationId: "org-home", toOrganizationName: "Консалтинг" });
  assert.match(plan.consequences.access.join(" "), /Ваш профиль переедет в «Консалтинг»/);
  assert.match(plan.consequences.access.join(" "), /войти заново/);
});

test("перевод: единственная организация, в которой живёт профиль, — отказ", () => {
  const snapshot = conversion({
    actor: { homeOrganizationId: "org-cafe" },
    partner: { applicantOrganizationId: null },
    account: {
      organizations: [
        { id: "org-cafe", name: "Кафе Ромашка", isDemo: false, kind: "regular", subscriptionEnd: null, createdAt: new Date("2024-01-01"), actorIsOwnerMember: true },
        // Демо — не дом: удаляется через неделю.
        { id: "org-demo", name: "Демо", isDemo: true, kind: "regular", subscriptionEnd: null, createdAt: new Date("2024-02-01"), actorIsOwnerMember: true },
      ],
      activeUsers: 3,
    },
  });
  assert.deepEqual(blockerCodes(snapshot), ["only_organization"]);
});

test("перевод: единственная организация аккаунта, но профиль живёт в другой — можно, аккаунт просто пустеет", () => {
  const plan = okConversion(
    conversion({
      account: {
        organizations: [
          { id: "org-cafe", name: "Кафе Ромашка", isDemo: false, kind: "regular", subscriptionEnd: null, createdAt: new Date("2024-01-01"), actorIsOwnerMember: true },
        ],
        activeUsers: 3,
      },
    }),
  );
  assert.equal(plan.ops.homeMove, null);
  assert.match(plan.consequences.seats.join(" "), /было 3, станет 0/);
  // Других организаций в аккаунте нет — про «свою оплату» аккаунта не пишем.
  assert.doesNotMatch(plan.consequences.payment.join(" "), /Ваш аккаунт сохраняет/);
});

// ------------------------------------------------------------ перевод: кто и что

test("перевод: блок виден только владельцу с действующим партнёрским кабинетом", () => {
  assert.equal(isConversionOffered(conversion()), true);
  assert.equal(isConversionOffered(conversion({ partner: { status: "pending" } })), false);
  assert.equal(isConversionOffered(conversion({ partner: null })), false);
  assert.equal(isConversionOffered(conversion({ account: { ownerUserId: "u-other" } })), false);
});

test("перевод: чужой аккаунт — отказ «не владелец»", () => {
  assert.deepEqual(blockerCodes(conversion({ account: { ownerUserId: "u-other" } })), ["not_owner"]);
});

test("перевод: организация без аккаунта (легаси) — владелец-член может перевести, срок — её собственный", () => {
  const orgEnd = days(40);
  const plan = okConversion(
    conversion({ account: null, organization: { accountId: null, subscriptionEnd: orgEnd, subscriptionPlan: "paid" } }),
  );
  assert.equal(plan.ops.fromAccountId, null);
  assert.deepEqual(plan.ops.organizationBilling, { subscriptionPlan: "paid", subscriptionEnd: orgEnd });
  assert.equal(plan.ops.accountEndRaiseTo, null);
  assert.deepEqual(
    blockerCodes(conversion({ account: null, organization: { accountId: null, actorMemberRole: "manager" } })),
    ["not_owner"],
  );
});

test("перевод: без действующего партнёрского кабинета — отказ", () => {
  assert.ok(blockerCodes(conversion({ partner: { status: "suspended" } })).includes("not_partner"));
  assert.ok(blockerCodes(conversion({ partner: null })).includes("not_partner"));
});

test("перевод: в режиме партнёра или «войти как» — отказ", () => {
  assert.deepEqual(blockerCodes(conversion({ actor: { inForeignMode: true } })), ["foreign_mode"]);
});

test("перевод: демо, мастер-кабинет, платформа, удаление — отказ", () => {
  assert.ok(blockerCodes(conversion({ organization: { isDemo: true } })).includes("demo"));
  assert.ok(blockerCodes(conversion({ organization: { kind: "directory" } })).includes("directory"));
  assert.ok(blockerCodes(conversion({ organization: { isPlatform: true } })).includes("platform"));
  assert.ok(blockerCodes(conversion({ organization: { deletionRequested: true } })).includes("deletion_requested"));
});

test("перевод: ИНН организации = ИНН партнёра — это сам партнёр, отказ", () => {
  assert.deepEqual(blockerCodes(conversion({ organization: { inn: "77 0123-4567" } })), ["partner_inn"]);
});

test("перевод: организация, из которой подана заявка партнёра, — отказ", () => {
  assert.deepEqual(
    blockerCodes(conversion({ partner: { applicantOrganizationId: "org-cafe" } })),
    ["applicant_organization"],
  );
});

test("перевод: люди команды — живущие здесь блокируют, члены снимаются поимённо", () => {
  assert.deepEqual(
    blockerCodes(conversion({ teamInOrganization: [{ userId: "u-team", name: "Ольга", livesHere: true, isMember: false }] })),
    ["team_lives_here"],
  );
  const plan = okConversion(
    conversion({ teamInOrganization: [{ userId: "u-team", name: "Ольга", livesHere: false, isMember: true }] }),
  );
  assert.deepEqual(plan.ops.removeMemberUserIds, ["u-owner", "u-team"]);
  assert.match(plan.consequences.access.join(" "), /партнёрской команды \(Ольга\)/);
});

test("перевод: уже есть консультант — свой или чужой", () => {
  assert.deepEqual(
    blockerCodes(conversion({ activeLink: { partnerId: "p-1", brandName: "Консалт Плюс" } })),
    ["already_client"],
  );
  const plan = planConversion(conversion({ activeLink: { partnerId: "p-2", brandName: "Другой консультант" } }));
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.blockers[0].code, "other_partner");
  assert.match(plan.blockers[0].message, /«Другой консультант»/);
});

test("перевод: несколько причин отказа показываются все сразу", () => {
  const codes = blockerCodes(
    conversion({
      organization: { isDemo: true },
      orders: [order({ paymentMethod: "invoice", invoiceDueAt: days(2) })],
    }),
  );
  assert.deepEqual(codes, ["demo", "pending_invoice"]);
});

// ------------------------------------------------------------ вознаграждение с последующих платежей

test("условия вознаграждения — из действующей версии правил", () => {
  assert.equal(
    rewardTermsText(DEFAULT_REWARD_RULE),
    "Вознаграждение по действующим правилам: 20 % от каждой оплаты подписки в течение 12 мес. с первой оплаты после перевода, " +
      "разовый бонус 3 000 ₽ за 2-ю оплату, 15 % от оборудования из комплекта после отгрузки.",
  );
  assert.equal(
    rewardTermsText({ ...DEFAULT_REWARD_RULE, subscriptionPercent: 0, bonusAmountRub: 0, hardwarePercent: 0 }),
    "Вознаграждение — по действующим правилам партнёрской программы.",
  );
});

test("начисления с платежей после перевода: первый открывает окно, второй даёт бонус, после окна — ничего", () => {
  // Привязка создана переводом; платежи до него `accrueForPaidOrder` не считает
  // (выборка `paidAt ≥ attachedAt`), поэтому первый платёж клиента — первый.
  const first = computePaymentAccruals(DEFAULT_REWARD_RULE, {
    paidAt: days(10),
    subscriptionRub: 1990,
    firstPaymentAt: null,
    paidSubscriptionPaymentsBefore: 0,
  });
  assert.deepEqual(first.map((d) => [d.kind, d.amountRub]), [["subscription", 398]]);
  const second = computePaymentAccruals(DEFAULT_REWARD_RULE, {
    paidAt: days(40),
    subscriptionRub: 1990,
    firstPaymentAt: days(10),
    paidSubscriptionPaymentsBefore: 1,
  });
  assert.deepEqual(second.map((d) => [d.kind, d.amountRub]), [["subscription", 398], ["bonus", 3000]]);
  const afterWindow = computePaymentAccruals(DEFAULT_REWARD_RULE, {
    paidAt: days(10 + 400),
    subscriptionRub: 1990,
    firstPaymentAt: days(10),
    paidSubscriptionPaymentsBefore: 12,
  });
  assert.deepEqual(afterWindow, []);
});

// ------------------------------------------------------------ возврат

type ReturnPatch = {
  now?: Date;
  link?: Partial<NonNullable<ReturnSnapshot["link"]>> | null;
  organization?: Partial<ReturnSnapshot["organization"]>;
  owner?: ReturnSnapshot["owner"];
  paidOrdersAfterConversion?: number;
  account?: Partial<NonNullable<ReturnSnapshot["account"]>> | null;
};

function returning(patch: ReturnPatch = {}): ReturnSnapshot {
  const base: ReturnSnapshot = {
    now: NOW,
    actor: { userId: "u-owner" },
    partnerId: "p-1",
    link: {
      id: "link-1",
      source: "converted",
      convertedByUserId: "u-owner",
      attachedAt: days(-5),
      detachedAt: null,
    },
    organization: {
      id: "org-cafe",
      name: "Кафе Ромашка",
      accountId: null,
      subscriptionPlan: "paid",
      subscriptionEnd: new Date("2026-12-01T09:00:00.000Z"),
      activeUsers: 3,
    },
    owner: null,
    paidOrdersAfterConversion: 0,
    account: {
      id: "acc-1",
      subscriptionPlan: "paid",
      subscriptionEnd: new Date("2026-12-01T09:00:00.000Z"),
      organizationEnds: [null, null],
      activeUsers: 4,
    },
    settings: DEFAULT_FREE_PERIOD,
  };
  return {
    ...base,
    now: patch.now ?? base.now,
    link: patch.link === null ? null : { ...(base.link as NonNullable<ReturnSnapshot["link"]>), ...patch.link },
    organization: { ...base.organization, ...patch.organization },
    owner: patch.owner === undefined ? base.owner : patch.owner,
    paidOrdersAfterConversion: patch.paidOrdersAfterConversion ?? base.paidOrdersAfterConversion,
    account: patch.account === null ? null : { ...(base.account as NonNullable<ReturnSnapshot["account"]>), ...patch.account },
  };
}

function returnCodes(snapshot: ReturnSnapshot): string[] {
  const plan = planReturn(snapshot);
  return plan.ok ? [] : plan.blockers.map((b) => b.code);
}

test("возврат: организация входит в личный аккаунт, привязка закрывается", () => {
  const plan = planReturn(returning());
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.ops, {
    organizationId: "org-cafe",
    linkId: "link-1",
    revokeOwner: null,
    attach: {
      ownerUserId: "u-owner",
      subscriptionPlan: "paid",
      subscriptionEnd: new Date("2026-12-01T09:00:00.000Z"),
    },
  });
  assert.match(plan.consequences.commission.join(" "), /вознаграждение с будущих оплат организации начисляться не будет/);
  assert.match(plan.consequences.seats.join(" "), /станет 7 \(сейчас 4, в организации 3\)/);
  assert.match(plan.consequences.access.join(" "), /Вы снова владелец/);
  assert.match(plan.consequences.payment.join(" "), /до 1 декабря 2026\) сохраняется/);
});

test("возврат: предлагается только тому, кто перевёл сам, и только у действующей привязки", () => {
  assert.equal(isReturnOffered(returning()), true);
  assert.equal(isReturnOffered(returning({ link: { convertedByUserId: "u-team" } })), false);
  assert.equal(isReturnOffered(returning({ link: { source: "manual", convertedByUserId: null } })), false);
  assert.equal(isReturnOffered(returning({ link: { detachedAt: days(-1) } })), false);
  assert.equal(isReturnOffered(returning({ link: null })), false);
});

test("возврат: чужая или не переведённая организация — отказ", () => {
  assert.deepEqual(returnCodes(returning({ link: { source: "link", convertedByUserId: null } })), ["not_converted"]);
  assert.deepEqual(returnCodes(returning({ link: { convertedByUserId: "u-team" } })), ["converted_by_other"]);
  assert.deepEqual(returnCodes(returning({ link: { detachedAt: days(-1) } })), ["link_missing"]);
  assert.deepEqual(returnCodes(returning({ link: null })), ["link_missing"]);
});

test("возврат: владение принято клиентом — отказ", () => {
  assert.deepEqual(
    returnCodes(
      returning({
        owner: { userId: "u-client", email: "boss@cafe.ru", isActive: true, isPendingInvite: false, accountId: "acc-client", accountOrganizations: 1 },
      }),
    ),
    ["owned_by_client"],
  );
});

test("возврат: неподтверждённое приглашение владельцу отменяется", () => {
  const plan = planReturn(
    returning({
      owner: { userId: "u-invited", email: "boss@cafe.ru", isActive: false, isPendingInvite: true, accountId: "acc-invited", accountOrganizations: 1 },
    }),
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.ops.revokeOwner, { userId: "u-invited", email: "boss@cafe.ru", accountId: "acc-invited" });
  assert.match(plan.consequences.access.join(" "), /Приглашение владельцу \(boss@cafe\.ru\) будет отменено/);
});

test("возврат: заглушку с чужими организациями в аккаунте не удаляем — отказ", () => {
  assert.deepEqual(
    returnCodes(
      returning({
        owner: { userId: "u-invited", email: "boss@cafe.ru", isActive: false, isPendingInvite: true, accountId: "acc-invited", accountOrganizations: 2 },
      }),
    ),
    ["owned_by_client"],
  );
});

test("возврат: после перевода организацию оплачивали — отказ", () => {
  assert.deepEqual(returnCodes(returning({ paidOrdersAfterConversion: 1 })), ["paid_after_conversion"]);
});

test("возврат: лимит мест в личном аккаунте на бесплатном тарифе — отказ с цифрами", () => {
  const snapshot = returning({
    organization: { subscriptionPlan: "free", subscriptionEnd: null, activeUsers: 2 },
    account: { subscriptionPlan: "free", subscriptionEnd: null, activeUsers: 1 },
  });
  assert.equal(mergedAccountState(snapshot)?.seatLimit, 1);
  const plan = planReturn(snapshot);
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.deepEqual(plan.blockers.map((b) => b.code), ["seat_limit"]);
  assert.match(plan.blockers[0].message, /на 1 сотрудника, а после возврата активных станет 3/);
});

test("возврат: лимит мест не мешает на оплаченном аккаунте, в бесплатный период и без людей", () => {
  const free = { subscriptionPlan: "free", subscriptionEnd: null } as const;
  // Аккаунт оплачен до будущей даты.
  assert.deepEqual(
    returnCodes(returning({ organization: { ...free, activeUsers: 5 }, account: { subscriptionPlan: "paid", subscriptionEnd: days(20), activeUsers: 1 } })),
    [],
  );
  // Бесплатный период.
  assert.deepEqual(
    returnCodes(returning({ now: IN_FREE_PERIOD, organization: { ...free, activeUsers: 5 }, account: { ...free, activeUsers: 1 } })),
    [],
  );
  // Людей в организации нет — добавлять нечего.
  assert.deepEqual(
    returnCodes(returning({ organization: { ...free, activeUsers: 0 }, account: { ...free, activeUsers: 1 } })),
    [],
  );
  // Своего аккаунта нет — заведётся с тарифом организации, сравнивать не с чем.
  assert.deepEqual(returnCodes(returning({ organization: { ...free, activeUsers: 5 }, account: null })), []);
});

test("возврат: без своего аккаунта он заводится с тарифом и сроком организации", () => {
  const end = days(30);
  const plan = planReturn(returning({ account: null, organization: { subscriptionEnd: end } }));
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.ops.attach, { ownerUserId: "u-owner", subscriptionPlan: "paid", subscriptionEnd: end });
  assert.match(plan.consequences.seats.join(" "), /заведётся аккаунт/);
});

test("даты — по Москве, без «г.»", () => {
  assert.equal(formatMskDate(new Date("2026-11-30T22:30:00.000Z")), "1 декабря 2026");
});

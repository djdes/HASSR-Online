import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_FREE_PERIOD,
  FREE_LIMIT_MESSAGE,
  announcementText,
  billingPhase,
  checkSeats,
  computeAccountBilling,
  decideTransitionAction,
  formatMskDay,
  freePeriodRangeLabel,
  isAutoUpgradeAllowed,
  isBillingEnforced,
  isReallyPaid,
  mskDayKey,
  normalizeFreePeriodSettings,
  pickKeeper,
  serializeFreePeriodSettings,
  shouldShowAnnouncement,
  transitionCopy,
  validateFreePeriodInput,
  type AccountBillingInput,
  type FreePeriodSettings,
} from "@/lib/billing-period";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { SUBSCRIPTION_MAX_USERS } from "@/lib/plan-catalog";

const S: FreePeriodSettings = DEFAULT_FREE_PERIOD;
const DAY = 24 * 60 * 60 * 1000;
/** МСК-время → Date. */
const msk = (iso: string) => new Date(`${iso}+03:00`);

const BEFORE = msk("2026-09-28T12:00:00");
const IN_PERIOD = msk("2026-10-05T12:00:00");
const LAST_MINUTE = msk("2026-10-10T23:59:59");
const AFTER = msk("2026-10-11T00:00:00");
const IN_GRACE = msk("2026-10-17T23:59:00");
const GRACE_OVER = msk("2026-10-18T00:00:00");

function state(input: Partial<AccountBillingInput>, now: Date, settings = S) {
  return computeAccountBilling(
    { plan: "free", subscriptionEnd: null, activeUsers: 1, ...input },
    settings,
    now
  );
}

describe("настройки бесплатного периода", () => {
  it("по умолчанию: 1 октября 00:00 МСК — 11 октября 00:00 МСК, грейс 7 дней, переход включён", () => {
    assert.equal(S.startsAt.toISOString(), msk("2026-10-01T00:00:00").toISOString());
    assert.equal(S.endsAt.toISOString(), msk("2026-10-11T00:00:00").toISOString());
    assert.equal(S.graceDays, 7);
    assert.equal(S.transitionEnabled, true);
  });

  it("пустые и битые значения заменяются дефолтами, JSON — туда и обратно", () => {
    assert.deepEqual(normalizeFreePeriodSettings(null), S);
    assert.deepEqual(normalizeFreePeriodSettings({ startsAt: "мусор", graceDays: "x" }), S);
    const custom: FreePeriodSettings = {
      startsAt: new Date("2026-11-01T00:00:00.000Z"),
      endsAt: new Date("2026-11-05T00:00:00.000Z"),
      graceDays: 3,
      transitionEnabled: false,
    };
    assert.deepEqual(
      normalizeFreePeriodSettings(JSON.parse(serializeFreePeriodSettings(custom))),
      custom
    );
    // Грейс за пределами — обрезается.
    assert.equal(normalizeFreePeriodSettings({ graceDays: 500 }).graceDays, 60);
  });

  it("проверка формы ROOT: конец позже начала, грейс 0–60, флаг обязателен", () => {
    const ok = validateFreePeriodInput({
      startsAt: "2026-10-01T00:00:00+03:00",
      endsAt: "2026-10-11T00:00:00+03:00",
      graceDays: 7,
      transitionEnabled: true,
    });
    assert.equal(ok.ok, true);
    assert.equal(
      validateFreePeriodInput({
        startsAt: "2026-10-11T00:00:00+03:00",
        endsAt: "2026-10-01T00:00:00+03:00",
        graceDays: 7,
        transitionEnabled: true,
      }).ok,
      false
    );
    assert.equal(
      validateFreePeriodInput({ startsAt: "2026-10-01", endsAt: "2026-10-11", graceDays: -1, transitionEnabled: true }).ok,
      false
    );
    assert.equal(
      validateFreePeriodInput({ startsAt: "2026-10-01", endsAt: "2026-10-11", graceDays: 7, transitionEnabled: "да" }).ok,
      false
    );
  });
});

describe("фаза по датам", () => {
  it("до / в периоде / после; конец — не включительно", () => {
    assert.equal(billingPhase(S, BEFORE), "before");
    assert.equal(billingPhase(S, S.startsAt), "free_period");
    assert.equal(billingPhase(S, IN_PERIOD), "free_period");
    assert.equal(billingPhase(S, LAST_MINUTE), "free_period");
    assert.equal(billingPhase(S, AFTER), "after");
  });

  it("переход действует только после конца и с включённым флагом; до него — автоперевод как раньше", () => {
    assert.equal(isBillingEnforced(S, IN_PERIOD), false);
    assert.equal(isBillingEnforced(S, AFTER), true);
    assert.equal(isBillingEnforced({ ...S, transitionEnabled: false }, AFTER), false);
    assert.equal(isAutoUpgradeAllowed(S, BEFORE), true);
    assert.equal(isAutoUpgradeAllowed(S, IN_PERIOD), true);
    assert.equal(isAutoUpgradeAllowed(S, AFTER), false);
    assert.equal(isAutoUpgradeAllowed({ ...S, transitionEnabled: false }, AFTER), true);
  });
});

describe("«реально оплачено»", () => {
  it("paid без срока — тестовый автоперевод, не оплата", () => {
    assert.equal(isReallyPaid("paid", null, AFTER), false);
  });
  it("срок в будущем — оплачено; в прошлом — нет; пауза — нет", () => {
    assert.equal(isReallyPaid("paid", new Date(AFTER.getTime() + DAY), AFTER), true);
    assert.equal(isReallyPaid("paid", new Date(AFTER.getTime() - DAY), AFTER), false);
    assert.equal(isReallyPaid("paused", new Date(AFTER.getTime() + DAY), AFTER), false);
  });
});

describe("состояние организации по датам", () => {
  it("до периода — как раньше (legacy): лимита нет, платные возможности по тарифу", () => {
    const free = state({ plan: "free", activeUsers: 3 }, BEFORE);
    assert.equal(free.kind, "legacy");
    assert.equal(free.seatLimit, null);
    assert.equal(free.paidFeatures, false);
    assert.equal(state({ plan: "paid", activeUsers: 5 }, BEFORE).paidFeatures, true);
  });

  it("в периоде — подписка до 10 у всех: лимита нет, платные возможности включены", () => {
    const s = state({ plan: "free", activeUsers: 8 }, IN_PERIOD);
    assert.equal(s.kind, "free_period");
    assert.equal(s.seatLimit, null);
    assert.equal(s.paidFeatures, true);
    assert.equal(state({ plan: "paused", activeUsers: 2 }, IN_PERIOD).paidFeatures, false);
  });

  it("после периода, ≤ 1 активного — бесплатный тариф без окна", () => {
    const s = state({ plan: "paid", activeUsers: 1 }, AFTER);
    assert.equal(s.kind, "free");
    assert.equal(s.seatLimit, FREE_MAX_USERS);
    assert.equal(s.paidFeatures, false);
  });

  it("после периода, > 1 активного и не оплачено — нужно решение, грейс 7 дней от конца периода", () => {
    const s = state({ plan: "paid", activeUsers: 5 }, AFTER);
    assert.equal(s.kind, "needs_decision");
    assert.equal(s.reason, "free_period_ended");
    assert.equal(s.graceEndsAt?.toISOString(), msk("2026-10-18T00:00:00").toISOString());
    assert.equal(s.graceExpired, false);
    assert.equal(state({ plan: "paid", activeUsers: 5 }, IN_GRACE).graceExpired, false);
    assert.equal(state({ plan: "paid", activeUsers: 5 }, GRACE_OVER).graceExpired, true);
    // Бесплатный тариф со старым лимитом (3 человека) — тоже решение.
    assert.equal(state({ plan: "free", activeUsers: 3 }, AFTER).kind, "needs_decision");
  });

  it("реально оплаченная подписка не трогается ни до, ни в, ни после периода", () => {
    const end = msk("2026-11-20T00:00:00");
    for (const now of [BEFORE, IN_PERIOD, AFTER, GRACE_OVER]) {
      const s = state({ plan: "paid", subscriptionEnd: end, activeUsers: 25 }, now);
      assert.equal(s.kind, "paid", now.toISOString());
      assert.equal(s.seatLimit, null);
      assert.equal(s.paidFeatures, true);
      assert.equal(shouldShowAnnouncement(s), false);
    }
  });

  it("истёкшая оплаченная подписка (после конца периода) — «Подписка закончилась», грейс от её конца", () => {
    const end = msk("2026-10-20T00:00:00");
    const now = msk("2026-10-21T10:00:00");
    const s = state({ plan: "paid", subscriptionEnd: end, activeUsers: 4 }, now);
    assert.equal(s.kind, "needs_decision");
    assert.equal(s.reason, "subscription_expired");
    assert.equal(s.graceEndsAt?.toISOString(), msk("2026-10-27T00:00:00").toISOString());
  });

  it("оплата кончилась ДО конца периода — последним кончился бесплатный период, про него и пишем", () => {
    const s = state({ plan: "paid", subscriptionEnd: msk("2026-09-15T00:00:00"), activeUsers: 4 }, AFTER);
    assert.equal(s.reason, "free_period_ended");
    assert.equal(s.graceEndsAt?.toISOString(), msk("2026-10-18T00:00:00").toISOString());
  });

  it("переход выключен — после периода всё как раньше", () => {
    const s = state({ plan: "paid", activeUsers: 9 }, AFTER, { ...S, transitionEnabled: false });
    assert.equal(s.kind, "legacy");
    assert.equal(s.seatLimit, null);
  });

  it("платформа, демо и мастер-кабинет — вне тарифа", () => {
    const s = state({ exempt: true, activeUsers: 30 }, AFTER);
    assert.equal(s.kind, "exempt");
    assert.equal(s.seatLimit, null);
  });

  it("оплаченная организация на паузе — без лимита, но без платных возможностей", () => {
    const s = state(
      { plan: "paid", subscriptionEnd: msk("2026-12-01T00:00:00"), activeUsers: 3, inactive: true },
      AFTER
    );
    assert.equal(s.kind, "paid");
    assert.equal(s.seatLimit, null);
    assert.equal(s.paidFeatures, false);
  });
});

describe("лимиты 1 / 10", () => {
  it("бесплатный — 1: второго активного добавить нельзя, понятная ошибка", () => {
    const s = state({ plan: "free", activeUsers: 1 }, AFTER);
    const check = checkSeats(s, 1);
    assert.equal(check.ok, false);
    if (!check.ok) {
      assert.equal(check.limit, 1);
      assert.equal(check.message, FREE_LIMIT_MESSAGE);
      assert.match(check.message, /Бесплатный тариф — 1 сотрудник\. Оплатите подписку/);
    }
    // Пустой аккаунт (владелец в архиве) — одного вернуть можно.
    assert.equal(checkSeats(state({ activeUsers: 0 }, AFTER), 1).ok, true);
  });

  it("нужно решение — добавлять тоже нельзя, пока не оплачено", () => {
    assert.equal(checkSeats(state({ plan: "paid", activeUsers: 4 }, AFTER), 1).ok, false);
  });

  it("оплачено — 10 не блокирует (сверх 10 — доплата, как было)", () => {
    const s = state(
      { plan: "paid", subscriptionEnd: msk("2026-11-20T00:00:00"), activeUsers: SUBSCRIPTION_MAX_USERS },
      AFTER
    );
    assert.equal(checkSeats(s, 5).ok, true);
  });

  it("до конца периода и с выключенным переходом — не блокирует", () => {
    assert.equal(checkSeats(state({ activeUsers: 1 }, BEFORE), 3).ok, true);
    assert.equal(checkSeats(state({ activeUsers: 1 }, IN_PERIOD), 3).ok, true);
    assert.equal(
      checkSeats(state({ activeUsers: 1 }, AFTER, { ...S, transitionEnabled: false }), 3).ok,
      true
    );
  });

  it("0 новых — всегда можно", () => {
    assert.equal(checkSeats(state({ activeUsers: 5, plan: "paid" }, AFTER), 0).ok, true);
  });
});

describe("ежедневная задача: что делать с аккаунтом", () => {
  it("≤ 1 и тариф ещё «платный» без оплаты — молча бесплатный; уже бесплатный — ничего", () => {
    assert.equal(decideTransitionAction(state({ plan: "paid", activeUsers: 1 }, AFTER), "paid"), "silent_free");
    assert.equal(decideTransitionAction(state({ plan: "free", activeUsers: 1 }, AFTER), "free"), "none");
  });

  it("> 1: в грейсе — ждём решения, грейс истёк — автопереход", () => {
    assert.equal(decideTransitionAction(state({ plan: "paid", activeUsers: 3 }, IN_GRACE), "paid"), "await_decision");
    assert.equal(decideTransitionAction(state({ plan: "paid", activeUsers: 3 }, GRACE_OVER), "paid"), "auto_free");
  });

  it("до конца периода, оплачено, пауза, выключенный переход — ничего", () => {
    assert.equal(decideTransitionAction(state({ plan: "paid", activeUsers: 3 }, IN_PERIOD), "paid"), "none");
    assert.equal(
      decideTransitionAction(
        state({ plan: "paid", subscriptionEnd: msk("2026-12-01T00:00:00"), activeUsers: 3 }, GRACE_OVER),
        "paid"
      ),
      "none"
    );
    assert.equal(
      decideTransitionAction(state({ plan: "paid", activeUsers: 3, inactive: true }, GRACE_OVER), "paid"),
      "none"
    );
    assert.equal(
      decideTransitionAction(
        state({ plan: "paid", activeUsers: 3 }, GRACE_OVER, { ...S, transitionEnabled: false }),
        "paid"
      ),
      "none"
    );
  });

  it("автопереход оставляет владельца; нет владельца — самого давнего руководителя", () => {
    const t = (d: number) => new Date(Date.UTC(2026, 0, d));
    const users = [
      { id: "cook", isManagement: false, createdAt: t(1) },
      { id: "chef", isManagement: true, createdAt: t(3) },
      { id: "owner", isManagement: true, createdAt: t(5) },
    ];
    assert.equal(pickKeeper(users, "owner"), "owner");
    assert.equal(pickKeeper(users, "gone"), "chef");
    assert.equal(pickKeeper(users.filter((u) => !u.isManagement), null), "cook");
    assert.equal(pickKeeper([], "owner"), null);
  });
});

describe("тексты", () => {
  it("анонс: даты и цена из настроек и тарифа", () => {
    const a = announcementText(S, 1990);
    assert.equal(a.lead, "С 1 по 10 октября подписка «до 10 сотрудников» бесплатна для всех.");
    assert.equal(a.tail, "С 11 октября — 1 990 ₽/мес или бесплатный тариф на 1 сотрудника.");
    const other = announcementText(
      { ...S, startsAt: msk("2026-09-28T00:00:00"), endsAt: msk("2026-10-04T00:00:00") },
      2490
    );
    assert.equal(other.lead, "С 28 сентября по 3 октября подписка «до 10 сотрудников» бесплатна для всех.");
    assert.match(other.tail ?? "", /С 4 октября — 2 490 ₽\/мес/);
    assert.equal(announcementText({ ...S, transitionEnabled: false }, 1990).tail, null);
  });

  it("анонс и окно в акцию: цена со скидкой, база — для зачёркивания", () => {
    const promo = {
      baseRub: 1990,
      priceRub: 1592,
      promotion: { id: "p1", title: "Осень", percent: 20, startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z" },
    };
    const a = announcementText(S, promo);
    const sp = (x: string | null | undefined) => (x ?? "").replace(/ /g, " ");
    assert.equal(sp(a.tail), "С 11 октября — 1 592 ₽/мес по акции (без акции 1 990 ₽) или бесплатный тариф на 1 сотрудника.");
    assert.equal(a.tailParts?.before, "С 11 октября — ");
    assert.equal(a.tailParts?.price.priceRub, 1592);
    assert.equal(a.tailParts?.after, " или бесплатный тариф на 1 сотрудника.");
    const copy = transitionCopy({ state: state({ plan: "paid", activeUsers: 5 }, AFTER), settings: S, priceRub: promo });
    assert.equal(copy.payPrice.baseRub, 1990);
    assert.equal(copy.payPrice.priceRub, 1592);
    assert.match(copy.payTerms, /^до 10 сотрудников, все остаются в работе/);
    assert.ok(sp(copy.payHint).startsWith("1 592 ₽/мес по акции (без акции 1 990 ₽) · до 10 сотрудников"));
    // Без акции (или «акция» не уценивает) — просто цена.
    const flat = transitionCopy({ state: state({ plan: "paid", activeUsers: 5 }, AFTER), settings: S, priceRub: { ...promo, priceRub: 1990 } });
    assert.ok(sp(flat.payHint).startsWith("1 990 ₽/мес · до 10"));
  });

  it("анонс — до конца периода и не оплатившим", () => {
    assert.equal(shouldShowAnnouncement(state({}, BEFORE)), true);
    assert.equal(shouldShowAnnouncement(state({}, IN_PERIOD)), true);
    assert.equal(shouldShowAnnouncement(state({ plan: "paid", activeUsers: 4 }, AFTER)), false);
  });

  it("окно честное: не платившим — «бесплатный период закончился», без слова «оплаченный»", () => {
    const copy = transitionCopy({ state: state({ plan: "paid", activeUsers: 5 }, AFTER), settings: S, priceRub: 1990 });
    assert.equal(copy.title, "Бесплатный период подписки закончился");
    assert.doesNotMatch(`${copy.title} ${copy.lead}`, /оплаченн/i);
    assert.match(copy.lead, /5 сотрудников/);
    assert.match(copy.lead, /бесплатный тариф — 1 сотрудник/);
    assert.match(copy.graceLine ?? "", /до 17 октября включительно/);
    assert.match(copy.payHint, /1 990 ₽\/мес · до 10 сотрудников/);
  });

  it("истёкшая оплаченная — «Подписка закончилась»", () => {
    const copy = transitionCopy({
      state: state({ plan: "paid", subscriptionEnd: msk("2026-10-20T00:00:00"), activeUsers: 2 }, msk("2026-10-21T00:00:00")),
      settings: S,
      priceRub: 1990,
    });
    assert.equal(copy.title, "Подписка закончилась");
  });

  it("даты по Москве", () => {
    assert.equal(formatMskDay(new Date("2026-09-30T21:00:00.000Z")), "1 октября");
    assert.equal(formatMskDay(new Date("2026-09-30T20:59:59.000Z")), "30 сентября");
    assert.equal(mskDayKey(new Date("2026-09-30T21:00:00.000Z")), "2026-10-01");
    assert.equal(freePeriodRangeLabel(S), "С 1 по 10 октября");
  });
});

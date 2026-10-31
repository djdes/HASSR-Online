import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_TRIAL_SETTINGS,
  FREE_LIMIT_MESSAGE,
  seatLimitMessage,
  checkJournals,
  checkPoints,
  checkSeats,
  checkStorage,
  computeAccountBilling,
  daysLeft,
  decideTransitionAction,
  formatBytes,
  formatMskDay,
  hasFeature,
  isReallyPaid,
  mskDayKey,
  normalizeTrialSettings,
  PAID_REMINDER_STAGES,
  paidReminderCopy,
  paidReminderDue,
  paidReminderStage,
  paidTierTitle,
  pickKeeper,
  pickKeeperJournal,
  serializeTrialSettings,
  shouldShowTrialBanner,
  transitionCopy,
  trialBannerText,
  trialEndFor,
  validateTrialInput,
  voluntaryDowngradeCheck,
  type AccountBillingInput,
  type TrialSettings,
} from "@/lib/billing-period";

const DAY = 24 * 60 * 60 * 1000;
/** МСК-время → Date. */
const msk = (iso: string) => new Date(`${iso}+03:00`);

const LAUNCH = msk("2026-10-26T00:00:00");
const S: TrialSettings = { ...DEFAULT_TRIAL_SETTINGS, launchedAt: LAUNCH };
const OLD_ACCOUNT = msk("2026-03-01T10:00:00");
const TRIAL_END_OLD = new Date(LAUNCH.getTime() + 14 * DAY);
const PRICES = { standardFromRub: 1990, premiumFromRub: 3990 };

function state(input: Partial<AccountBillingInput>, now: Date, settings = S) {
  return computeAccountBilling(
    { plan: "free", subscriptionEnd: null, activeUsers: 1, enabledJournals: 1, createdAt: OLD_ACCOUNT, ...input },
    settings,
    now
  );
}

describe("настройки пробного периода", () => {
  it("по умолчанию: 14 дней, грейс 7, переход включён", () => {
    assert.equal(DEFAULT_TRIAL_SETTINGS.trialDays, 14);
    assert.equal(DEFAULT_TRIAL_SETTINGS.graceDays, 7);
    assert.equal(DEFAULT_TRIAL_SETTINGS.transitionEnabled, true);
  });

  it("битые значения заменяются дефолтами, JSON — туда и обратно", () => {
    assert.deepEqual(normalizeTrialSettings(null), DEFAULT_TRIAL_SETTINGS);
    assert.deepEqual(
      normalizeTrialSettings({ trialDays: "x", launchedAt: "nope", graceDays: 999, transitionEnabled: "yes" }),
      DEFAULT_TRIAL_SETTINGS
    );
    const custom: TrialSettings = { trialDays: 14, launchedAt: LAUNCH, graceDays: 3, transitionEnabled: false };
    assert.deepEqual(normalizeTrialSettings(JSON.parse(serializeTrialSettings(custom))), custom);
    // Длина пробного — как в текстах витрины: сохранённое число не читается.
    assert.equal(normalizeTrialSettings({ ...JSON.parse(serializeTrialSettings(custom)), trialDays: 30 }).trialDays, 14);
  });

  it("форма ROOT: дата обязательна, грейс 0–60, флаг обязателен; длина пробного — тарифная, не из формы", () => {
    assert.equal(validateTrialInput({ launchedAt: "", graceDays: 7, transitionEnabled: true }).ok, false);
    assert.equal(validateTrialInput({ launchedAt: LAUNCH.toISOString(), graceDays: 61, transitionEnabled: true }).ok, false);
    assert.equal(validateTrialInput({ launchedAt: LAUNCH.toISOString(), graceDays: 7, transitionEnabled: "1" }).ok, false);
    const ok = validateTrialInput({ launchedAt: LAUNCH.toISOString(), graceDays: 7, transitionEnabled: true });
    assert.equal(ok.ok, true);
    assert.equal(ok.ok && ok.value.trialDays, 14);
  });

  it("конец пробного: 14 дней от создания, но не раньше запуска; продление ROOT побеждает", () => {
    const fresh = msk("2026-11-02T15:00:00");
    assert.equal(trialEndFor(fresh, S).getTime(), fresh.getTime() + 14 * DAY);
    assert.equal(trialEndFor(OLD_ACCOUNT, S).getTime(), TRIAL_END_OLD.getTime());
    const extended = msk("2026-12-31T00:00:00");
    assert.equal(trialEndFor(OLD_ACCOUNT, S, extended).getTime(), extended.getTime());
  });
});

describe("«реально оплачено»", () => {
  it("срок в будущем — оплачено; без срока, в прошлом и на паузе — нет", () => {
    const now = msk("2026-11-01T12:00:00");
    assert.equal(isReallyPaid("premium", new Date(now.getTime() + DAY), now), true);
    assert.equal(isReallyPaid("paid", null, now), false);
    assert.equal(isReallyPaid("standard", new Date(now.getTime() - DAY), now), false);
    assert.equal(isReallyPaid("paused", new Date(now.getTime() + DAY), now), false);
  });
});

describe("состояние аккаунта по датам", () => {
  it("пробный: 14 дней без ограничений и со всеми возможностями", () => {
    const now = msk("2026-10-30T12:00:00");
    const s = state({ activeUsers: 40, enabledJournals: 35, pointsInUse: 6 }, now);
    assert.equal(s.kind, "free_period");
    assert.equal(s.tier, "trial");
    assert.equal(s.seatLimit, null);
    assert.equal(s.entitlements.pointLimit, null);
    assert.equal(s.entitlements.journalLimit, null);
    assert.equal(hasFeature(s, "photoAutofill"), true);
    assert.equal(s.trialDaysLeft, daysLeft(TRIAL_END_OLD, now));
    assert.equal(s.enforcement, false);
  });

  it("новый аккаунт: пробный 14 дней от регистрации", () => {
    const created = msk("2026-12-01T10:00:00");
    const inTrial = state({ createdAt: created, activeUsers: 5, enabledJournals: 20 }, msk("2026-12-14T10:00:00"));
    assert.equal(inTrial.kind, "free_period");
    const after = state({ createdAt: created, activeUsers: 5, enabledJournals: 20 }, msk("2026-12-15T10:00:01"));
    assert.equal(after.kind, "needs_decision");
  });

  it("после пробного: 1 сотрудник и 1 журнал — бесплатный тариф без окна", () => {
    const s = state({}, new Date(TRIAL_END_OLD.getTime() + DAY));
    assert.equal(s.kind, "free");
    assert.equal(s.tier, "free");
    assert.equal(s.seatLimit, 1);
    assert.equal(s.entitlements.storageBytes, 0);
    assert.equal(hasFeature(s, "photoAutofill"), false);
    assert.equal(s.enforcement, true);
  });

  it("после пробного: больше 1 сотрудника ИЛИ журнала — нужно решение, грейс 7 дней", () => {
    const now = new Date(TRIAL_END_OLD.getTime() + 2 * DAY);
    const users = state({ activeUsers: 3, enabledJournals: 1 }, now);
    const journals = state({ activeUsers: 1, enabledJournals: 12 }, now);
    for (const s of [users, journals]) {
      assert.equal(s.kind, "needs_decision");
      assert.equal(s.reason, "trial_ended");
      assert.equal(s.graceEndsAt?.getTime(), TRIAL_END_OLD.getTime() + 7 * DAY);
      assert.equal(s.graceExpired, false);
      assert.equal(s.seatLimit, 1);
    }
    const late = state({ activeUsers: 3 }, new Date(TRIAL_END_OLD.getTime() + 7 * DAY));
    assert.equal(late.graceExpired, true);
  });

  it("оплачено: Стандарт и Премиум с лимитами тарифа, прежняя «Подписка» — как раньше", () => {
    const now = msk("2026-11-20T12:00:00");
    const until = new Date(now.getTime() + 10 * DAY);
    const standard = state({ plan: "standard", subscriptionEnd: until, planPoints: 2, planCycle: "year", activeUsers: 30 }, now);
    assert.equal(standard.kind, "paid");
    assert.equal(standard.tier, "standard");
    assert.equal(standard.paidTier, "standard");
    assert.equal(standard.planCycle, "year");
    assert.equal(standard.seatLimit, 50);
    assert.equal(hasFeature(standard, "photoAutofill"), false);
    const premium = state({ plan: "premium", subscriptionEnd: until }, now);
    assert.equal(premium.tier, "premium");
    assert.equal(hasFeature(premium, "equipmentConnect"), true);
    const legacy = state({ plan: "paid", subscriptionEnd: until, activeUsers: 60 }, now);
    assert.equal(legacy.tier, "legacy_paid");
    assert.equal(legacy.paidTier, "legacy");
    assert.equal(legacy.seatLimit, null);
    assert.equal(hasFeature(legacy, "photoAutofill"), true);
  });

  it("оплата раньше пробного не прерывает расчёт: оплачено — значит paid", () => {
    const now = msk("2026-10-28T12:00:00");
    const s = state({ plan: "premium", subscriptionEnd: new Date(now.getTime() + 30 * DAY) }, now);
    assert.equal(s.kind, "paid");
  });

  it("истёкшая оплаченная подписка (после пробного) — «Подписка закончилась», грейс от её конца", () => {
    const end = new Date(TRIAL_END_OLD.getTime() + 40 * DAY);
    const s = state({ plan: "standard", subscriptionEnd: end, activeUsers: 4 }, new Date(end.getTime() + DAY));
    assert.equal(s.kind, "needs_decision");
    assert.equal(s.reason, "subscription_expired");
    assert.equal(s.graceEndsAt?.getTime(), end.getTime() + 7 * DAY);
  });

  it("переход выключен в ROOT — после пробного ничего не блокируем", () => {
    const s = state({ activeUsers: 9, enabledJournals: 30 }, new Date(TRIAL_END_OLD.getTime() + 30 * DAY), {
      ...S,
      transitionEnabled: false,
    });
    assert.equal(s.kind, "legacy");
    assert.equal(s.seatLimit, null);
    assert.equal(s.entitlements.journalLimit, null);
  });

  it("платформа, демо и мастер-кабинет — вне тарифа, без лимитов", () => {
    const s = state({ exempt: true, activeUsers: 500 }, new Date(TRIAL_END_OLD.getTime() + 30 * DAY));
    assert.equal(s.kind, "exempt");
    assert.equal(s.seatLimit, null);
    assert.equal(s.entitlements.storageBytes, null);
  });

  it("оплаченная организация на паузе — лимиты тарифа, но без платных возможностей", () => {
    const now = msk("2026-11-20T12:00:00");
    const s = state({ plan: "premium", subscriptionEnd: new Date(now.getTime() + DAY), inactive: true }, now);
    assert.equal(s.kind, "paid");
    assert.equal(s.inactive, true);
    assert.equal(hasFeature(s, "photoAutofill"), false);
  });
});

describe("лимиты", () => {
  const after = new Date(TRIAL_END_OLD.getTime() + DAY);

  it("бесплатный — 1 сотрудник: второго добавить нельзя, зовём на «Стандарт»", () => {
    const check = checkSeats(state({}, after), 1);
    assert.equal(check.ok, false);
    if (!check.ok) {
      assert.equal(check.message, FREE_LIMIT_MESSAGE);
      assert.match(check.message, /Перейдите на «Стандарт» — до 25 сотрудников на точку/);
      assert.equal(check.tier, "free");
      assert.equal(check.nextTier, "standard");
    }
  });

  it("Стандарт — 25 на точку: 26-го нельзя, зовём на «Премиум», а не «добавьте точку»", () => {
    const now = msk("2026-11-20T12:00:00");
    const s = state({ plan: "standard", subscriptionEnd: new Date(now.getTime() + DAY), activeUsers: 25 }, now);
    const check = checkSeats(s, 1);
    assert.equal(check.ok, false);
    if (!check.ok) {
      assert.match(check.message, /«Стандарт» — до 25 сотрудников на точку/);
      assert.match(check.message, /Перейдите на «Премиум» — до 100 сотрудников на точку/);
      assert.doesNotMatch(check.message, /точку на странице|Добавьте точку|добавьте точку/);
      assert.equal(check.nextTier, "premium");
    }
    assert.equal(checkSeats(state({ plan: "standard", subscriptionEnd: new Date(now.getTime() + DAY), activeUsers: 24 }, now), 1).ok, true);
  });

  it("Премиум — 100 на точку: 101-го нельзя, больше — по согласованию", () => {
    const now = msk("2026-11-20T12:00:00");
    const paid = { plan: "premium", subscriptionEnd: new Date(now.getTime() + DAY) };
    assert.equal(checkSeats(state({ ...paid, activeUsers: 99 }, now), 1).ok, true);
    const check = checkSeats(state({ ...paid, activeUsers: 100 }, now), 1);
    assert.equal(check.ok, false);
    if (!check.ok) {
      assert.equal(check.limit, 100);
      assert.equal(check.nextTier, null);
      assert.match(check.message, /Больше 100 сотрудников на точку — по согласованию/);
      assert.doesNotMatch(check.message, /Добавьте точку|добавьте точку/);
    }
    // Две точки «Премиума» — 200 мест.
    assert.equal(checkSeats(state({ ...paid, activeUsers: 150, planPoints: 2 }, now), 1).ok, true);
  });

  it("приглашённому — не «бесплатный тариф» на оплаченном: просьба к руководителю по тарифу", () => {
    const now = msk("2026-11-20T12:00:00");
    const standard = state({ plan: "standard", subscriptionEnd: new Date(now.getTime() + DAY), activeUsers: 25 }, now);
    const premium = state({ plan: "premium", subscriptionEnd: new Date(now.getTime() + DAY), activeUsers: 100 }, now);
    assert.match(seatLimitMessage(standard, "invitee"), /перейти на «Премиум»/);
    assert.match(seatLimitMessage(premium, "invitee"), /связаться с поддержкой/);
    // Лимит тарифа назван и приглашённому (страница входа по QR показывает этот текст).
    assert.match(seatLimitMessage(standard, "invitee"), /«Стандарт» — до 25 сотрудников на точку, все места заняты/);
    assert.match(seatLimitMessage(premium, "invitee"), /«Премиум» — до 100 сотрудников на точку, все места заняты/);
    assert.match(seatLimitMessage(state({}, after), "invitee"), /подключить «Стандарт»/);
  });

  it("пробный и 0 новых — всегда можно", () => {
    assert.equal(checkSeats(state({ activeUsers: 100 }, msk("2026-10-27T00:00:00")), 10).ok, true);
    assert.equal(checkSeats(state({}, after), 0).ok, true);
  });

  it("точки: бесплатный — 1, оплачено — сколько купили", () => {
    assert.equal(checkPoints(state({ pointsInUse: 1 }, after), 1).ok, false);
    const now = msk("2026-11-20T12:00:00");
    const paid = state({ plan: "premium", subscriptionEnd: new Date(now.getTime() + DAY), planPoints: 2, pointsInUse: 1 }, now);
    assert.equal(checkPoints(paid, 1).ok, true);
    const full = state({ plan: "premium", subscriptionEnd: new Date(now.getTime() + DAY), planPoints: 2, pointsInUse: 2 }, now);
    const refused = checkPoints(full, 1);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.message, /скидка 5 %/);
  });

  it("журналы: на бесплатном включить второй нельзя, выключать можно всегда", () => {
    const s = state({}, after);
    assert.equal(checkJournals(s, 2, 1).ok, false);
    assert.equal(checkJournals(s, 1, 1).ok, true);
    // Было 12 (до решения) — выключить до 5 можно, хотя это больше лимита.
    assert.equal(checkJournals(state({ activeUsers: 1, enabledJournals: 12 }, after), 5, 12).ok, true);
  });

  it("хранилище: Стандарт 10 МБ, бесплатный — загрузка закрыта, замена файла учитывает старый", () => {
    const now = msk("2026-11-20T12:00:00");
    const standard = state({ plan: "standard", subscriptionEnd: new Date(now.getTime() + DAY) }, now);
    const MB = 1024 * 1024;
    assert.equal(checkStorage(standard.entitlements, 9 * MB, MB / 2).ok, true);
    const over = checkStorage(standard.entitlements, 9 * MB, 2 * MB);
    assert.equal(over.ok, false);
    if (!over.ok) assert.match(over.message, /«Премиум» — 1 ГБ/);
    assert.equal(checkStorage(standard.entitlements, 9 * MB, 2 * MB, 2 * MB).ok, true);
    const free = checkStorage(state({}, after).entitlements, 0, 1);
    assert.equal(free.ok, false);
    assert.equal(checkStorage(state({ exempt: true }, after).entitlements, 10_000 * MB, MB).ok, true);
    assert.equal(formatBytes(9.2 * MB), "9,2 МБ");
    assert.equal(formatBytes(1024 * MB), "1 ГБ");
    assert.equal(formatBytes(0), "0 КБ");
    assert.equal(formatBytes(300), "1 КБ");
  });
});

describe("ежедневная задача", () => {
  it("за 3 дня до конца пробного — напоминание, раньше — ничего", () => {
    assert.equal(decideTransitionAction(state({}, new Date(TRIAL_END_OLD.getTime() - 2 * DAY)), "free"), "remind_trial_end");
    assert.equal(decideTransitionAction(state({}, new Date(TRIAL_END_OLD.getTime() - 6 * DAY)), "free"), "none");
  });

  it("в пределах бесплатного и тариф ещё записан платным — молча бесплатный; уже бесплатный — ничего", () => {
    const after = new Date(TRIAL_END_OLD.getTime() + DAY);
    assert.equal(decideTransitionAction(state({ plan: "standard" }, after), "standard"), "silent_free");
    assert.equal(decideTransitionAction(state({}, after), "free"), "none");
  });

  it("сверх бесплатного: в грейсе — ждём решения, грейс истёк — автопереход", () => {
    assert.equal(decideTransitionAction(state({ activeUsers: 2 }, new Date(TRIAL_END_OLD.getTime() + DAY)), "free"), "await_decision");
    assert.equal(decideTransitionAction(state({ activeUsers: 2 }, new Date(TRIAL_END_OLD.getTime() + 8 * DAY)), "free"), "auto_free");
  });

  it("оплачено больше недели, пауза, выключенный переход — ничего", () => {
    const now = new Date(TRIAL_END_OLD.getTime() + 8 * DAY);
    assert.equal(decideTransitionAction(state({ plan: "premium", subscriptionEnd: new Date(now.getTime() + 30 * DAY) }, now), "premium"), "none");
    assert.equal(decideTransitionAction(state({ plan: "premium", subscriptionEnd: new Date(now.getTime() + 8 * DAY) }, now), "premium"), "none");
    // Оплаченная, но приостановленная за неактивность — напоминаний нет.
    assert.equal(
      decideTransitionAction(state({ plan: "premium", subscriptionEnd: new Date(now.getTime() + DAY), inactive: true }, now), "premium"),
      "none"
    );
    assert.equal(decideTransitionAction(state({ activeUsers: 5, inactive: true }, now), "paused"), "none");
    assert.equal(
      decideTransitionAction(state({ activeUsers: 5 }, now, { ...S, transitionEnabled: false }), "free"),
      "none"
    );
  });

  it("автопереход оставляет владельца; нет владельца — самого давнего руководителя", () => {
    const t = (d: string) => new Date(d);
    const candidates = [
      { id: "cook", isManagement: false, createdAt: t("2026-01-01") },
      { id: "chef", isManagement: true, createdAt: t("2026-02-01") },
      { id: "owner", isManagement: true, createdAt: t("2026-03-01") },
    ];
    assert.equal(pickKeeper(candidates, "owner"), "owner");
    assert.equal(pickKeeper(candidates, "gone"), "chef");
    assert.equal(pickKeeper([candidates[0]], null), "cook");
    assert.equal(pickKeeper([], "owner"), null);
  });

  it("автопереход оставляет самый заполняемый журнал; без записей — гигиенический или первый", () => {
    const usage = new Map([["cleaning", 40], ["hygiene", 12]]);
    assert.equal(pickKeeperJournal(["hygiene", "cleaning", "cold_equipment_control"], usage), "cleaning");
    assert.equal(pickKeeperJournal(["cleaning", "hygiene"], new Map()), "hygiene");
    assert.equal(pickKeeperJournal(["cleaning", "acceptance"], new Map()), "cleaning");
    assert.equal(pickKeeperJournal([], usage), null);
  });
});

describe("тексты", () => {
  it("плашка пробного: дни и последний день по Москве", () => {
    const now = new Date(TRIAL_END_OLD.getTime() - 5 * DAY + 60_000);
    const s = state({}, now);
    assert.equal(shouldShowTrialBanner(s), true);
    const banner = trialBannerText(s);
    assert.match(banner?.lead ?? "", /осталось 5 дней — по 8 ноября включительно/);
    assert.equal(banner?.urgent, false);
    assert.equal(trialBannerText(state({}, new Date(TRIAL_END_OLD.getTime() - DAY)))?.urgent, true);
    assert.equal(shouldShowTrialBanner(state({}, new Date(TRIAL_END_OLD.getTime() + DAY))), false);
  });

  it("окно честное: не платившим — «Пробный период закончился», цифры сотрудников и журналов", () => {
    const s = state({ activeUsers: 4, enabledJournals: 18 }, new Date(TRIAL_END_OLD.getTime() + DAY));
    const copy = transitionCopy({ state: s, prices: PRICES });
    assert.equal(copy.title, "Пробный период закончился");
    assert.match(copy.lead, /4 сотрудника и 18 журналов/);
    assert.match(copy.lead, /1 сотрудник и 1 журнал/);
    assert.doesNotMatch(copy.lead, /оплаченн/i);
    assert.match(copy.payHint, /от 1\s990 ₽\/мес/);
    assert.match(copy.graceLine ?? "", /Выберите до 15 ноября включительно/);
  });

  it("истёкшая оплаченная — «Подписка закончилась»", () => {
    const end = new Date(TRIAL_END_OLD.getTime() + 40 * DAY);
    const copy = transitionCopy({ state: state({ plan: "premium", subscriptionEnd: end, activeUsers: 3 }, new Date(end.getTime() + DAY)), prices: PRICES });
    assert.equal(copy.title, "Подписка закончилась");
  });

  it("добровольный переход: нельзя у вне тарифа и на паузе", () => {
    assert.equal(voluntaryDowngradeCheck({ kind: "exempt", inactive: false }).ok, false);
    assert.equal(voluntaryDowngradeCheck({ kind: "paid", inactive: true }).ok, false);
    assert.equal(voluntaryDowngradeCheck({ kind: "free_period", inactive: false }).ok, true);
  });

  it("даты по Москве", () => {
    assert.equal(formatMskDay(msk("2026-11-08T23:59:59")), "8 ноября");
    assert.equal(mskDayKey(msk("2026-11-09T00:00:01")), "2026-11-09");
  });
});

describe("напоминания о конце оплаченного срока", () => {
  const now = msk("2026-11-02T10:00:00");
  const paid = (daysAhead: number, extra: Partial<AccountBillingInput> = {}) =>
    state({ plan: "standard", subscriptionEnd: new Date(now.getTime() + daysAhead * DAY), activeUsers: 6, ...extra }, now);

  it("ступени 7 → 3 → 1: больше недели и после конца — ничего", () => {
    assert.deepEqual([...PAID_REMINDER_STAGES], [7, 3, 1]);
    assert.equal(paidReminderStage(8), null);
    assert.equal(paidReminderStage(7), 7);
    assert.equal(paidReminderStage(4), 7);
    assert.equal(paidReminderStage(3), 3);
    assert.equal(paidReminderStage(2), 3);
    assert.equal(paidReminderStage(1), 1);
    assert.equal(paidReminderStage(0), null);
    assert.equal(paidReminderStage(null), null);
  });

  it("у оплаченной организации считаются оставшиеся дни, задача решает «напомнить» в последнюю неделю", () => {
    assert.equal(paid(5).paidDaysLeft, 5);
    assert.equal(paid(0.5).paidDaysLeft, 1);
    assert.equal(state({}, now).paidDaysLeft, null);
    assert.equal(decideTransitionAction(paid(7), "standard"), "remind_paid_end");
    assert.equal(decideTransitionAction(paid(2.5), "standard"), "remind_paid_end");
    assert.equal(decideTransitionAction(paid(0.2), "standard"), "remind_paid_end");
    assert.equal(decideTransitionAction(paid(7.5), "standard"), "none");
    // Срок кончился: дальше работают грейс и «выберите тариф», не это напоминание.
    assert.notEqual(decideTransitionAction(paid(-1), "standard"), "remind_paid_end");
  });

  it("одно напоминание на ступень одного срока; пропущенный день не теряет ближайшую", () => {
    const until = new Date(now.getTime() + 3 * DAY);
    const iso = until.toISOString();
    assert.equal(paidReminderDue([], until, 7), true);
    assert.equal(paidReminderDue([{ paidUntil: iso, stage: 7 }], until, 7), false);
    assert.equal(paidReminderDue([{ paidUntil: iso, stage: 7 }], until, 3), true);
    assert.equal(paidReminderDue([{ paidUntil: iso, stage: 7 }, { paidUntil: iso, stage: 3 }], until, 3), false);
    // Ступень 3 пропущена (задача не работала) — ступень 1 всё равно уходит, один раз.
    assert.equal(paidReminderDue([{ paidUntil: iso, stage: 7 }], until, 1), true);
    assert.equal(paidReminderDue([{ paidUntil: iso, stage: 1 }], until, 1), false);
    // Срок продлили — по новому сроку напоминания заново.
    const renewed = new Date(until.getTime() + 30 * DAY);
    assert.equal(paidReminderDue([{ paidUntil: iso, stage: 1 }], renewed, 7), true);
    // Мусор в журнале не мешает.
    assert.equal(paidReminderDue([null, "x", { stage: "7" }, { paidUntil: iso }], until, 7), true);
  });

  it("текст: организация, тариф, точки, дата, что будет после; без перехода — без угрозы", () => {
    const copy = paidReminderCopy({
      orgName: "Кафе &amp; Ко",
      tierTitle: paidTierTitle("standard"),
      points: 2,
      lastDayLabel: "4 ноября",
      daysLeft: 3,
      graceDays: 7,
      transitionEnabled: true,
    });
    assert.equal(copy.head, "Оплата «Кафе &amp; Ко» заканчивается через 3 дня — тариф «Стандарт», 2 точки, по 4 ноября включительно.");
    assert.match(copy.renew, /новый период прибавится к текущему сроку/);
    assert.match(copy.renew, /по счёту для юрлица/);
    assert.match(copy.after, /ещё 7 дней на оплату/);
    assert.match(copy.after, /записи сохранятся/);
    const single = paidReminderCopy({
      orgName: "Цех",
      tierTitle: paidTierTitle("legacy"),
      points: 1,
      lastDayLabel: "2 ноября",
      daysLeft: 1,
      graceDays: 0,
      transitionEnabled: true,
    });
    assert.equal(single.head, "Оплата «Цех» заканчивается через 1 день — тариф «Подписка», по 2 ноября включительно.");
    assert.match(single.after, /^Если не продлить, сразу после окончания/);
    const noTransition = paidReminderCopy({
      orgName: "Цех",
      tierTitle: paidTierTitle("premium"),
      points: 1,
      lastDayLabel: "2 ноября",
      daysLeft: 1,
      graceDays: 7,
      transitionEnabled: false,
    });
    assert.equal(noTransition.after, "");
    assert.match(noTransition.head, /«Премиум»/);
  });
});

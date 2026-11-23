import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createLinkTracker, resolveTrackedLink } from "@/lib/mailing/links";
import {
  DEFAULT_MAILING_SETTINGS,
  emailBudget,
  mskDayStart,
  emailDomain,
  normalizeMailingSettings,
  normalizeWindow,
  validateMailingSettingsInput,
  windowDue,
} from "@/lib/mailing/rate-limit";
import { newRecipientId, signRecipientToken, verifyRecipientToken } from "@/lib/mailing/tokens";

const SECRET = "test-secret-0123456789-abcdef";

describe("подпись токенов", () => {
  it("свой токен проверяется и возвращает id", () => {
    const id = newRecipientId();
    assert.match(id, /^mr[0-9a-f]{20}$/);
    const token = signRecipientToken(id, SECRET);
    assert.equal(verifyRecipientToken(token, SECRET), id);
  });

  it("подделка, чужой секрет и мусор — отказ", () => {
    const token = signRecipientToken("mr0123456789abcdef0123", SECRET);
    const [id, sig] = token.split(".");
    const flipped = `${id}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;
    assert.equal(verifyRecipientToken(flipped, SECRET), null);
    assert.equal(verifyRecipientToken(`mr0123456789abcdef0124.${sig}`, SECRET), null);
    assert.equal(verifyRecipientToken(token, "another-secret-0123456789"), null);
    assert.equal(verifyRecipientToken("", SECRET), null);
    assert.equal(verifyRecipientToken("../../etc/passwd", SECRET), null);
    assert.equal(verifyRecipientToken(null, SECRET), null);
  });

  it("без секрета токен не выпускается", () => {
    assert.throws(() => signRecipientToken("mr1", "short"));
  });
});

describe("клики: редирект только по сохранённым ссылкам", () => {
  it("номер ссылки стабилен, повтор — тот же номер", () => {
    const tracker = createLinkTracker("https://wesetup.ru/", "tok.en");
    const a = tracker.track("https://wesetup.ru/pricing");
    const b = tracker.track("/dashboard");
    const again = tracker.track("https://wesetup.ru/pricing");
    assert.equal(a, "https://wesetup.ru/r/tok.en/0");
    assert.equal(b, "https://wesetup.ru/r/tok.en/1");
    assert.equal(again, a);
    assert.deepEqual(tracker.links, ["https://wesetup.ru/pricing", "/dashboard"]);
  });

  it("опасный адрес не попадает в список учёта", () => {
    const tracker = createLinkTracker("https://wesetup.ru", "t");
    tracker.track("javascript:alert(1)");
    assert.deepEqual(tracker.links, []);
  });

  it("адрес берётся только из списка получателя по номеру", () => {
    const stored = ["https://wesetup.ru/pricing", "/dashboard"];
    assert.equal(resolveTrackedLink(stored, "0"), "https://wesetup.ru/pricing");
    assert.equal(resolveTrackedLink(stored, "1"), "/dashboard");
    assert.equal(resolveTrackedLink(stored, "2"), null);
    assert.equal(resolveTrackedLink(stored, "-1"), null);
    assert.equal(resolveTrackedLink(stored, "0?to=https://evil.example"), null);
    assert.equal(resolveTrackedLink(stored, "https://evil.example"), null);
    assert.equal(resolveTrackedLink("https://evil.example", "0"), null);
    // Даже если в базе оказался опасный адрес — не ведём.
    assert.equal(resolveTrackedLink(["javascript:alert(1)"], "0"), null);
    assert.equal(resolveTrackedLink(["//evil.example"], "0"), null);
  });
});

describe("ограничение скорости и суточный лимит", () => {
  it("по умолчанию — без ограничения (максимум), битое — по умолчанию", () => {
    assert.deepEqual(DEFAULT_MAILING_SETTINGS, {
      enabled: true,
      perMinute: 600,
      perHour: 36_000,
      perDay: 100_000,
      perDomainHour: 36_000,
      gapHours: 0,
    });
    assert.deepEqual(normalizeMailingSettings(null), DEFAULT_MAILING_SETTINGS);
    // Старая запись без новых полей — новые по умолчанию, очередь включена.
    assert.deepEqual(normalizeMailingSettings({ perMinute: "5", perDay: -3 }), {
      ...DEFAULT_MAILING_SETTINGS,
      perMinute: 5,
      perDay: 1,
    });
    assert.equal(normalizeMailingSettings({ enabled: false }).enabled, false);
    assert.equal(normalizeMailingSettings({ gapHours: 9999 }).gapHours, 720);
  });

  it("проверка формы ROOT", () => {
    assert.equal(validateMailingSettingsInput({ perMinute: 10, perDay: 200 }).ok, true);
    assert.equal(validateMailingSettingsInput({ perMinute: 0, perDay: 200 }).ok, false);
    assert.equal(validateMailingSettingsInput({ perMinute: 30, perDay: 20 }).ok, false);
    assert.equal(validateMailingSettingsInput({ perMinute: 1.5, perDay: 20 }).ok, false);
    // Частичное сохранение: чего нет во вводе — как было.
    const base = { ...DEFAULT_MAILING_SETTINGS, perMinute: 10, perDay: 200 };
    const off = validateMailingSettingsInput({ enabled: false }, base);
    assert.ok(off.ok && off.value.enabled === false && off.value.perMinute === 10);
    assert.equal(validateMailingSettingsInput({ gapHours: 721 }, base).ok, false);
    assert.equal(validateMailingSettingsInput({ perHour: 5 }, base).ok, false, "в час меньше, чем в минуту");
    assert.equal(validateMailingSettingsInput({ enabled: "yes" }, base).ok, false);
  });

  it("часовой лимит в бюджете", () => {
    const s = { perMinute: 20, perHour: 30, perDay: 300 };
    assert.deepEqual(emailBudget(s, 0, 0, 25), { budget: 5, limitedBy: null });
    assert.deepEqual(emailBudget(s, 0, 10, 30), { budget: 0, limitedBy: "hour" });
  });

  it("окно отправки по Москве", () => {
    // 22:30 МСК → 09:00 следующего дня.
    assert.equal(windowDue(new Date("2026-09-29T19:30:00Z"), 9, 21).toISOString(), "2026-09-30T06:00:00.000Z");
    // 07:10 МСК → 09:00 того же дня.
    assert.equal(windowDue(new Date("2026-09-29T04:10:00Z"), 9, 21).toISOString(), "2026-09-29T06:00:00.000Z");
    // В окне и круглосуточно — сейчас.
    const noon = new Date("2026-09-29T09:00:00Z");
    assert.equal(windowDue(noon, 9, 21), noon);
    assert.equal(windowDue(new Date("2026-09-29T00:00:00Z"), 0, 24).toISOString(), "2026-09-29T00:00:00.000Z");
    assert.deepEqual(normalizeWindow(9, 21), { windowStart: 9, windowEnd: 21 });
    assert.equal(normalizeWindow(21, 9), null);
    assert.equal(normalizeWindow(0, 25), null);
    assert.equal(emailDomain("A@Mail.RU"), "mail.ru");
  });

  it("бюджет — меньшее из минутного и суточного остатка", () => {
    const s = { perMinute: 20, perDay: 300 };
    assert.deepEqual(emailBudget(s, 0, 0), { budget: 20, limitedBy: null });
    assert.deepEqual(emailBudget(s, 15, 100), { budget: 5, limitedBy: null });
    assert.deepEqual(emailBudget(s, 20, 100), { budget: 0, limitedBy: "minute" });
    assert.deepEqual(emailBudget(s, 0, 290), { budget: 10, limitedBy: null });
    assert.deepEqual(emailBudget(s, 0, 300), { budget: 0, limitedBy: "day" });
    assert.deepEqual(emailBudget(s, 25, 310), { budget: 0, limitedBy: "day" });
  });

  it("сутки считаются с 00:00 по Москве", () => {
    // 29.09 23:59 МСК → начало дня 29.09 00:00 МСК.
    assert.equal(mskDayStart(new Date("2026-09-29T20:59:00Z")).toISOString(), "2026-09-28T21:00:00.000Z");
    // 30.09 00:00 МСК → новый день.
    assert.equal(mskDayStart(new Date("2026-09-29T21:00:00Z")).toISOString(), "2026-09-29T21:00:00.000Z");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createLinkTracker, resolveTrackedLink } from "@/lib/mailing/links";
import {
  DEFAULT_MAILING_SETTINGS,
  emailBudget,
  mskDayStart,
  normalizeMailingSettings,
  validateMailingSettingsInput,
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
  it("по умолчанию 20 в минуту и 300 в сутки, битое — по умолчанию", () => {
    assert.deepEqual(DEFAULT_MAILING_SETTINGS, { perMinute: 20, perDay: 300 });
    assert.deepEqual(normalizeMailingSettings(null), DEFAULT_MAILING_SETTINGS);
    assert.deepEqual(normalizeMailingSettings({ perMinute: "5", perDay: -3 }), { perMinute: 5, perDay: 1 });
  });

  it("проверка формы ROOT", () => {
    assert.equal(validateMailingSettingsInput({ perMinute: 10, perDay: 200 }).ok, true);
    assert.equal(validateMailingSettingsInput({ perMinute: 0, perDay: 200 }).ok, false);
    assert.equal(validateMailingSettingsInput({ perMinute: 30, perDay: 20 }).ok, false);
    assert.equal(validateMailingSettingsInput({ perMinute: 1.5, perDay: 20 }).ok, false);
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

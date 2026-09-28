import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LOGIN_CODE_DELIVERY_KIND } from "@/lib/login-challenge";
import { isUrgentKind, parseQuietHours, quietUntil } from "@/lib/quiet-hours";

describe("parseQuietHours", () => {
  it("принимает только включённое окно с валидными часами", () => {
    assert.deepEqual(parseQuietHours({ enabled: true, from: "22:00", to: "08:00" }), { enabled: true, from: "22:00", to: "08:00" });
    assert.equal(parseQuietHours({ enabled: false, from: "22:00", to: "08:00" }), null);
    assert.equal(parseQuietHours({ enabled: true, from: "25:00", to: "08:00" }), null);
    assert.equal(parseQuietHours({ enabled: true, from: "08:00", to: "08:00" }), null);
    assert.equal(parseQuietHours(null), null);
  });
});

describe("quietUntil", () => {
  const q = { enabled: true, from: "22:00", to: "08:00" };
  it("окно через полночь по московскому времени", () => {
    // 23:30 МСК = 20:30 UTC → тихо до 08:00 МСК (05:00 UTC)
    assert.equal(quietUntil(new Date("2026-09-10T20:30:00Z"), "Europe/Moscow", q)?.toISOString(), "2026-09-11T05:00:00.000Z");
    // 12:00 МСК — не тихо
    assert.equal(quietUntil(new Date("2026-09-10T09:00:00Z"), "Europe/Moscow", q), null);
    // 03:00 МСК — тихо до 08:00
    assert.equal(quietUntil(new Date("2026-09-11T00:00:00Z"), "Europe/Moscow", q)?.toISOString(), "2026-09-11T05:00:00.000Z");
  });
  it("дневное окно и выключенные часы", () => {
    assert.equal(quietUntil(new Date("2026-09-10T10:00:00Z"), "Europe/Moscow", { enabled: true, from: "12:00", to: "14:00" })?.toISOString(), "2026-09-10T11:00:00.000Z");
    assert.equal(quietUntil(new Date("2026-09-10T10:00:00Z"), "Europe/Moscow", null), null);
  });
});

describe("isUrgentKind", () => {
  it("температура и отклонения — срочно, дайджест — нет", () => {
    assert.equal(isUrgentKind("temperature.deviation"), true);
    assert.equal(isUrgentKind("compliance"), false);
    assert.equal(isUrgentKind(null), false);
  });

  it("код входа уходит сразу и в тихие часы: иначе ночью не войти", () => {
    assert.equal(isUrgentKind(LOGIN_CODE_DELIVERY_KIND), true);
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { ageLabel } from "@/lib/support-threads-shared";
import { ageParts, chatAge, chatErrorKey, deliveryKey, formatChatTimestamp } from "./chat-presentation";

test("chat age preserves every historical rounding boundary, invalid and future inputs", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  const ru = { ageNow: "только что", ageMinutes: "{count} мин", ageHours: "{count} ч", ageDays: "{count} дн" };
  const t = (key: keyof typeof ru, values: { count: string }) => ru[key].replace("{count}", values.count);
  for (const delta of [-1e8, -1, 0, 29999, 30000, 59999, 60000, 3598999, 3599000, 3600000, 86398999, 86399000, 86400000, 86400000 * 99]) {
    const from = new Date(now.getTime() - delta);
    assert.equal(chatAge(from, t, now), ageLabel(from, now));
    assert.equal(chatAge(from.toISOString(), t, now), ageLabel(from.toISOString(), now));
  }
  assert.deepEqual(ageParts("invalid", now), { key: "ageDays", count: "NaN" });
  assert.equal(chatAge("invalid", t, now), ageLabel("invalid", now));
});

test("timestamp preserves native Russian/English and invalid values", () => {
  for (const value of ["2026-10-16T00:30:01Z", "2024-02-29T23:59:59Z", "2026-01-01", "invalid"]) {
    assert.equal(formatChatTimestamp(value, "ru"), new Date(value).toLocaleString("ru-RU"));
    assert.equal(formatChatTimestamp(value, "en"), new Date(value).toLocaleString("en-GB"));
  }
  assert.equal(formatChatTimestamp("invalid", "uz"), new Date("invalid").toLocaleString("uz-Latn-UZ"));
});

test("only own known API failures translate and each delivery combination has a complete key", () => {
  for (const input of ["__proto__", "constructor", "PRIVATE", null, undefined, {}, 4]) {
    assert.equal(chatErrorKey(input), "sendFailed");
    assert.equal(chatErrorKey(input, "broadcastFailed"), "broadcastFailed");
  }
  assert.equal(chatErrorKey("Сообщение слишком длинное"), "messageTooLong");
  for (const operation of ["reply", "compose"] as const) {
    const keys = new Set<string>();
    for (const inApp of [false, true]) for (const telegram of [false, true]) keys.add(deliveryKey({ inApp, telegram }, operation));
    assert.equal(keys.size, 4);
    assert.equal(deliveryKey(undefined, operation), "deliveredChat");
  }
});

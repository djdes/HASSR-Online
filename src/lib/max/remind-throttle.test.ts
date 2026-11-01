import assert from "node:assert/strict";
import test from "node:test";

import { lastReminderFor, remindScopeKey, remindWaitMinutes, withReminder } from "./remind-throttle";

const now = new Date("2026-11-01T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

test("ключ области: точка руководителя или вся компания", () => {
  assert.equal(remindScopeKey(null), "org");
  assert.equal(remindScopeKey({ points: ["b"] }), "b");
  assert.equal(remindScopeKey({ points: ["b", "a"] }), "a+b");
  assert.equal(remindScopeKey({ points: [] }), "org");
});

test("руководитель точки А не блокирует напоминание руководителю точки Б", () => {
  const map = withReminder(null, "point-a", new Date(minutesAgo(5)));
  assert.equal(remindWaitMinutes(lastReminderFor(map, "point-a", null), now.getTime()), 25);
  assert.equal(remindWaitMinutes(lastReminderFor(map, "point-b", null), now.getTime()), null);
  assert.equal(remindWaitMinutes(lastReminderFor(map, "org", null), now.getTime()), null);
});

test("до появления карты действует старая общая отметка, после — только карта", () => {
  const legacy = new Date(minutesAgo(10));
  assert.equal(remindWaitMinutes(lastReminderFor(null, "point-a", legacy), now.getTime()), 20);
  assert.equal(remindWaitMinutes(lastReminderFor({}, "org", legacy), now.getTime()), 20);
  const map = { "point-b": minutesAgo(1) };
  assert.equal(lastReminderFor(map, "org", legacy), null);
});

test("через полчаса снова можно; старые отметки карта выбрасывает", () => {
  const map = { "point-a": minutesAgo(31), "point-old": minutesAgo(60 * 25), junk: "не дата" };
  assert.equal(remindWaitMinutes(lastReminderFor(map, "point-a", null), now.getTime()), null);
  const next = withReminder(map, "org", now);
  assert.deepEqual(Object.keys(next).sort(), ["org", "point-a"]);
  assert.equal(next.org, now.toISOString());
});

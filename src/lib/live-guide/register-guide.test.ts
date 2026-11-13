import assert from "node:assert/strict";
import test from "node:test";

import { LIVE_GUIDE_TTL_MS, REGISTER_GUIDE, fieldConditionMet, parseGuideState, stepForPath } from "@/lib/live-guide/register-guide";

test("шаг для страницы: пропуск вперёд, но не назад", () => {
  assert.equal(stepForPath(REGISTER_GUIDE, 0, "/register"), 0);
  const profile = REGISTER_GUIDE.findIndex((step) => step.id === "profile");
  // Нажали «Создать аккаунт» — оказались на /home: гид на анкете.
  assert.equal(stepForPath(REGISTER_GUIDE, 2, "/home"), profile);
  // На /login (почта уже занята) гиду нечего показывать.
  assert.equal(stepForPath(REGISTER_GUIDE, 2, "/login"), null);
  // С главной на /register назад не возвращаемся.
  assert.equal(stepForPath(REGISTER_GUIDE, profile, "/register"), null);
});

test("условия полей", () => {
  assert.equal(fieldConditionMet({ kind: "email" }, "anna@mail.ru", false), true);
  assert.equal(fieldConditionMet({ kind: "email" }, "anna@mail", false), false);
  assert.equal(fieldConditionMet({ kind: "checked" }, "", true), true);
  assert.equal(fieldConditionMet({ kind: "digits", n: 11 }, "+7 (999) 123-45-67", false), true);
  assert.equal(fieldConditionMet({ kind: "minLength", n: 2 }, " К ", false), false);
});

test("состояние гида: битое и просроченное не принимаем", () => {
  const now = 1_000_000_000;
  assert.deepEqual(parseGuideState(JSON.stringify({ id: "register", step: 3, startedAt: now }), now), { id: "register", step: 3, startedAt: now });
  assert.equal(parseGuideState(JSON.stringify({ id: "register", step: 3, startedAt: now - LIVE_GUIDE_TTL_MS - 1 }), now), null);
  assert.equal(parseGuideState(JSON.stringify({ id: "other", step: 0, startedAt: now }), now), null);
  assert.equal(parseGuideState(JSON.stringify({ id: "register", step: 99, startedAt: now }), now), null);
  assert.equal(parseGuideState("{", now), null);
});

test("у каждого шага с целью есть подпись цели в разметке", () => {
  const ids = new Set(REGISTER_GUIDE.map((step) => step.id));
  assert.equal(ids.size, REGISTER_GUIDE.length);
  for (const step of REGISTER_GUIDE) assert.ok(step.target, step.id);
});

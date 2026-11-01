import assert from "node:assert/strict";
import test from "node:test";

import { withOrgJournalOverride } from "./org-journal-settings";

const template = { id: "t1", fillMode: "single", defaultAssigneeId: "user-of-other-org", bonusAmountKopecks: 5000 };

test("без своей настройки — значения шаблона", () => {
  assert.deepEqual(withOrgJournalOverride(template, undefined), template);
  assert.deepEqual(withOrgJournalOverride(template, null), template);
});

test("своё распределение и бонус организации важнее шаблона", () => {
  const own = withOrgJournalOverride(template, { fillMode: "per-employee", defaultAssigneeId: "me", bonusAmountKopecks: 0 });
  assert.equal(own.fillMode, "per-employee");
  assert.equal(own.defaultAssigneeId, "me");
  assert.equal(own.bonusAmountKopecks, 0, "бонус 0 — тоже выбор организации");
});

test("null в настройке — дефолт шаблона для режима и бонуса", () => {
  const own = withOrgJournalOverride(template, { fillMode: null, defaultAssigneeId: null, bonusAmountKopecks: null });
  assert.equal(own.fillMode, "single");
  assert.equal(own.bonusAmountKopecks, 5000);
});

test("исполнитель шаблона (человек чужой организации) не просачивается, если есть своя настройка", () => {
  const own = withOrgJournalOverride(template, { fillMode: "single", defaultAssigneeId: null, bonusAmountKopecks: null });
  assert.equal(own.defaultAssigneeId, null);
});

test("не добавляет полей, которых не было у объекта", () => {
  const own = withOrgJournalOverride({ id: "t1", bonusAmountKopecks: 100 }, { fillMode: "sensor", defaultAssigneeId: "me", bonusAmountKopecks: 300 });
  assert.deepEqual(own, { id: "t1", bonusAmountKopecks: 300 });
});

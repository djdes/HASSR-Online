import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECKLIST_DEFAULTS,
  CHECKLIST_DEFAULTS_BY_SPHERE,
  defaultChecklistFor,
} from "@/lib/checklist-defaults";
import { ORG_SPHERES, type OrgSphere } from "@/lib/org-profile";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { SPHERE_RULES } from "@/lib/sphere-journal-rules";

const catalogCodes = new Set<string>(ACTIVE_JOURNAL_CATALOG.map((item) => item.code));

test("типовые чек-листы есть для каждого журнала из checklistJournals всех сфер", () => {
  for (const rules of Object.values(SPHERE_RULES)) {
    for (const code of rules.checklistJournals) {
      for (const items of [defaultChecklistFor(code), defaultChecklistFor(code, rules.sphere)]) {
        assert.ok(items.length >= 5 && items.length <= 8, `${rules.sphere}/${code}: ${items.length} пунктов, нужно 5–8`);
      }
    }
  }
});

const sphereValues = new Set<string>(ORG_SPHERES.map((item) => item.value));

test("у фитнеса, отеля и салона — свои пункты уборок, у остальных — общие", () => {
  const own: Array<[OrgSphere, string[]]> = [
    ["fitness", ["cleaning", "general_cleaning", "disinfectant_usage"]],
    ["hotel", ["cleaning", "general_cleaning"]],
    ["beauty", ["cleaning", "general_cleaning"]],
  ];
  for (const [sphere, codes] of own) {
    for (const code of codes) {
      const items = defaultChecklistFor(code, sphere);
      assert.notDeepEqual(items, CHECKLIST_DEFAULTS[code], `${sphere}/${code}: взялись общие пункты`);
      assert.ok(items.length >= 5 && items.length <= 7, `${sphere}/${code}: ${items.length} пунктов, нужно 5–7`);
    }
  }
  // Пищевых слов в пунктах уборки не-пищевых сфер быть не должно.
  for (const sphere of ["fitness", "hotel", "beauty"] as const) {
    const text = defaultChecklistFor("cleaning", sphere).map((item) => item.title).join(" ");
    assert.doesNotMatch(text, /солонк|кухн/i, `${sphere}: в уборке пищевые пункты`);
  }
  assert.match(defaultChecklistFor("cleaning", "fitness").map((i) => i.title).join(" "), /тренаж/i);
  assert.match(defaultChecklistFor("cleaning", "hotel").map((i) => i.title).join(" "), /выезд/i);
  assert.match(defaultChecklistFor("cleaning", "beauty").map((i) => i.title).join(" "), /клиент/i);
  for (const sphere of ["restaurant", "cafe", "education", "medical", "other"] as const) {
    assert.deepEqual(defaultChecklistFor("cleaning", sphere), CHECKLIST_DEFAULTS.cleaning, sphere);
  }
  assert.deepEqual(defaultChecklistFor("cleaning", null), CHECKLIST_DEFAULTS.cleaning);
});

test("стерилизация инструментов — в общей таблице", () => {
  assert.ok(CHECKLIST_DEFAULTS.instrument_sterilization.length >= 5);
  assert.deepEqual(
    defaultChecklistFor("instrument_sterilization", "beauty"),
    CHECKLIST_DEFAULTS.instrument_sterilization,
  );
});

test("сферные наборы — для существующих сфер и журналов каталога, поля заполнены", () => {
  for (const [sphere, byCode] of Object.entries(CHECKLIST_DEFAULTS_BY_SPHERE)) {
    assert.ok(sphereValues.has(sphere), `${sphere}: нет такой сферы`);
    for (const [code, items] of Object.entries(byCode ?? {})) {
      assert.ok(catalogCodes.has(code), `${sphere}/${code}: нет в каталоге`);
      const titles = new Set<string>();
      for (const item of items ?? []) {
        assert.ok(item.title.trim().length >= 15 && item.title.length <= 200, `${sphere}/${code}: «${item.title}»`);
        assert.ok((item.hint ?? "").length <= 500, `${sphere}/${code}: длинная подсказка`);
        assert.ok(!titles.has(item.title), `${sphere}/${code}: дубль «${item.title}»`);
        titles.add(item.title);
        if (item.frequency === "weekly") assert.ok(item.weekDays?.length, `${sphere}/${code}: weekly без weekDays`);
        if (item.frequency === "monthly") assert.ok(item.monthDay, `${sphere}/${code}: monthly без monthDay`);
        assert.ok(item.category !== "current" && item.category !== "general", `${sphere}/${code}: служебная category`);
      }
      assert.ok((items ?? []).some((item) => item.required), `${sphere}/${code}: нет обязательных`);
    }
  }
});

test("чек-листы только для журналов каталога", () => {
  for (const code of Object.keys(CHECKLIST_DEFAULTS)) {
    assert.ok(catalogCodes.has(code), `${code}: нет в каталоге`);
  }
});

test("пункты заполнены: текст, частота и дни для weekly/monthly", () => {
  for (const [code, items] of Object.entries(CHECKLIST_DEFAULTS)) {
    const titles = new Set<string>();
    for (const item of items) {
      assert.ok(item.title.trim().length >= 15, `${code}: слишком короткий пункт «${item.title}»`);
      // Лимиты редактора чек-листа (/api/settings/journal-checklists):
      // label ≤ 200, hint ≤ 500 — типовой пункт должен туда помещаться.
      assert.ok(item.title.length <= 200, `${code}: пункт длиннее 200 символов`);
      assert.ok((item.hint ?? "").length <= 500, `${code}: подсказка длиннее 500 символов`);
      assert.ok(!titles.has(item.title), `${code}: дубль «${item.title}»`);
      titles.add(item.title);
      if (item.frequency === "weekly") {
        assert.ok(item.weekDays && item.weekDays.length > 0, `${code}: weekly без weekDays`);
        for (const day of item.weekDays) assert.ok(day >= 1 && day <= 7, `${code}: день недели ${day}`);
      }
      if (item.frequency === "monthly") {
        assert.ok(item.monthDay && item.monthDay >= 1 && item.monthDay <= 31, `${code}: monthly без monthDay`);
      }
      // category в БД зарезервирована под автосинхронизацию уборки.
      assert.ok(item.category !== "current" && item.category !== "general", `${code}: служебная category`);
    }
    assert.ok(items.some((item) => item.required), `${code}: нет ни одного обязательного пункта`);
  }
});

test("для журнала без набора — пустой список", () => {
  assert.deepEqual(defaultChecklistFor("no_such_journal"), []);
});

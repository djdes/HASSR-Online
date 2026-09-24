import assert from "node:assert/strict";
import test from "node:test";

import { CHECKLIST_DEFAULTS, defaultChecklistFor } from "@/lib/checklist-defaults";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { SPHERE_RULES } from "@/lib/sphere-journal-rules";

const catalogCodes = new Set<string>(ACTIVE_JOURNAL_CATALOG.map((item) => item.code));

test("типовые чек-листы есть для каждого журнала из checklistJournals всех сфер", () => {
  for (const rules of Object.values(SPHERE_RULES)) {
    for (const code of rules.checklistJournals) {
      const items = defaultChecklistFor(code);
      assert.ok(items.length >= 5 && items.length <= 8, `${code}: ${items.length} пунктов, нужно 5–8`);
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

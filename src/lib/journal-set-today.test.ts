import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ACTIVE_JOURNAL_CATALOG } from "./journal-catalog";
import { JOURNAL_SETS, JOURNAL_SET_IDS } from "./journal-sets";
import { journalSetTodayStatus, summarizeJournalSet } from "./journal-set-today";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");
const pageFile = (id: string) => ["src", "app", "(dashboard)", "journals", "sets", id, "page.tsx"];

test("статус дня: выключен / заполнен / не заполнен / не требуется", () => {
  assert.equal(journalSetTodayStatus("hygiene", false, true), "off");
  assert.equal(journalSetTodayStatus("hygiene", true, true), "filled");
  // Ежедневный журнал без записи за сегодня — «не заполнен».
  assert.equal(journalSetTodayStatus("hygiene", true, false), "notFilled");
  assert.equal(journalSetTodayStatus("finished_product", true, false), "notFilled");
  // Журнал по событию без записи — «не требуется сегодня», с записью — «заполнен».
  assert.equal(journalSetTodayStatus("pest_control", true, false), "notRequired");
  assert.equal(journalSetTodayStatus("pest_control", true, true), "filled");
});

test("итог набора: включено N из M, заполнено K из ждущих записи", () => {
  const summary = summarizeJournalSet([
    { code: "hygiene", enabled: true, today: "filled" },
    { code: "climate_control", enabled: true, today: "notFilled" },
    { code: "pest_control", enabled: true, today: "notRequired" },
    { code: "med_books", enabled: false, today: "off" },
  ]);
  assert.deepEqual(summary, { total: 4, enabled: 3, required: 2, filled: 1, disabledCodes: ["med_books"] });
  assert.deepEqual(summarizeJournalSet([]), { total: 0, enabled: 0, required: 0, filled: 0, disabledCodes: [] });
});

test("заголовок и пояснение набора на русском — те же, что в JOURNAL_SETS", () => {
  const ru = JSON.parse(read("src", "i18n", "messages", "ru.json")) as {
    journalSets: { sets: Record<string, { title: string; description: string }> };
  };
  for (const id of JOURNAL_SET_IDS) {
    assert.equal(ru.journalSets.sets[id].title, JOURNAL_SETS[id].title, id);
    assert.equal(ru.journalSets.sets[id].description, JOURNAL_SETS[id].description, id);
  }
});

test("страницы наборов: свой набор, guard руководства, без зашитых кодов журналов", () => {
  const sources = [
    ...JOURNAL_SET_IDS.map((id) => {
      const source = read(...pageFile(id));
      assert.ok(source.includes(`setId="${id}"`), `${id}: страница показывает свой набор`);
      assert.ok(source.includes("hasFullWorkspaceAccess("), `${id}: guard как у API наборов`);
      return { name: id, source };
    }),
    { name: "journal-set-page", source: read("src", "components", "journals", "journal-set-page.tsx") },
    { name: "journal-set-client", source: read("src", "components", "journals", "journal-set-client.tsx") },
  ];
  for (const { name, source } of sources) {
    for (const { code } of ACTIVE_JOURNAL_CATALOG) {
      assert.ok(!source.includes(`"${code}"`) && !source.includes(`'${code}'`), `${name}: зашит код ${code}`);
    }
  }
});

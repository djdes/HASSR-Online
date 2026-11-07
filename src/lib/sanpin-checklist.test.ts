import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { JOURNAL_INFO } from "@/content/journal-info";
import { SANPIN_CHECKLIST, checklistDemoTopic, checklistResult, checklistVerdict } from "@/lib/sanpin-checklist";

/**
 * Чек-лист «Готовы ли вы к проверке» на странице СанПиН
 * (`.agent/tasks/growth-stage4-2026-11/spec.md`, AC2).
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("чек-лист «Готовы ли вы к проверке»", () => {
  it("7 вопросов: 6 по журналам каталога с основанием 4282-26 и выгрузка к проверке", () => {
    assert.equal(SANPIN_CHECKLIST.length, 7);
    const journals = SANPIN_CHECKLIST.filter((item) => item.journalCode !== null);
    assert.deepEqual(
      journals.map((item) => item.journalCode),
      ["hygiene", "cold_equipment_control", "incoming_control", "finished_product", "cleaning", "disinfectant_usage"],
    );
    for (const item of journals) {
      const info = Object.values(JOURNAL_INFO).find((journal) => journal.code === item.journalCode);
      assert.ok(info, `нет в каталоге: ${item.journalCode}`);
      assert.ok(info.normative.some((normative) => normative.title.includes("4282-26")), `${item.journalCode}: основание не 4282-26`);
    }
    assert.equal(new Set(SANPIN_CHECKLIST.map((item) => item.id)).size, 7);
    const texts = SANPIN_CHECKLIST.flatMap((item) => [item.question, item.gap]).join("\n");
    assert.doesNotMatch(texts, /штраф|обязательн|бланк/i);
  });

  it("итог: балл, пробелы по порядку, готово — только когда отвечены все", () => {
    const partial = checklistResult({ hygiene: "yes", cold: "no" });
    assert.equal(partial.complete, false);
    assert.equal(partial.answered, 2);
    const answers = Object.fromEntries(SANPIN_CHECKLIST.map((item) => [item.id, "yes" as const]));
    const all = checklistResult(answers);
    assert.equal(all.complete, true);
    assert.equal(all.score, 7);
    assert.equal(checklistVerdict(all), "Все 7 пунктов закрыты");
    const gaps = checklistResult({ ...answers, finished: "no", hygiene: "no", inspection: "no" });
    assert.equal(gaps.score, 4);
    assert.deepEqual(gaps.gaps.map((item) => item.id), ["hygiene", "finished", "inspection"]);
    assert.equal(checklistVerdict(gaps), "Закрыто 4 из 7");
  });

  it("в окно записи на показ — что не закрыто, названиями журналов", () => {
    const answers = Object.fromEntries(SANPIN_CHECKLIST.map((item) => [item.id, "yes" as const]));
    const names = { hygiene: "Гигиенический журнал", finished_product: "Бракеражный журнал" };
    const topic = checklistDemoTopic(checklistResult({ ...answers, hygiene: "no", finished: "no", inspection: "no" }), names);
    assert.equal(topic, "Чек-лист СанПиН: 4 из 7. Не закрыто: Гигиенический журнал, Бракеражный журнал, показать журналы за период.");
    assert.match(checklistDemoTopic(checklistResult(answers), names), /^Чек-лист СанПиН: 7 из 7\./);
    assert.ok(topic.length <= 500);
  });

  it("страница: чек-лист перед списком журналов, запись с пробелами, цель Метрики", () => {
    const page = read("src/app/sanpin-2-3-2-4-4282-26/page.tsx");
    assert.match(page, /<SanpinChecklist items=\{checklist\} trialDays=\{TRIAL_DAYS\} \/>/);
    assert.ok(page.indexOf("<SanpinChecklist") < page.indexOf('data-testid="sanpin-journals"'));
    assert.match(page, /href="#checklist"/);
    const component = read("src/components/public/sanpin-checklist.tsx");
    assert.match(component, /ymGoal\("sanpin_checklist", \{ score: result\.score \}\)/);
    assert.match(component, /<DemoRequestButton place="sanpin-checklist" variant="primary" topic=\{checklistDemoTopic\(result, journalNames\)\}>/);
    assert.match(component, /role="radiogroup"/);
    assert.match(read("src/components/public/demo-request-button.tsx"), /useState\(initialTopic \?\? ""\)/);
  });
});

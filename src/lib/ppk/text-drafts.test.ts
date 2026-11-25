import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDraftPrompt, cleanDraftReply, DRAFT_BLOCKS, DRAFT_JOB_TYPE, DRAFT_MAX, isDraftBlock, type DraftContext } from "./text-drafts";
import { PPK_STRUCTURE_ITEMS } from "./structure";

const context: DraftContext = {
  organization: "ООО «Ромашка»",
  object: "Кафе на Ленина",
  address: "г. Пермь, ул. Ленина, 1",
  sphere: "Общественное питание и производство пищевой продукции",
  food: true,
  staffCount: 12,
  team: [
    { name: "Иванова Анна Петровна", title: "Технолог", role: "leader" },
    { name: "Петров Олег", title: "Шеф-повар", role: "member" },
  ],
  products: ["Салат «Цезарь»", "Борщ"],
  hazards: ["Приёмка сырья — Сальмонеллы в мясе (биологический)"],
  controlPoints: ["ККТ 1 — Термообработка: недостаточный прогрев"],
  journals: ["Гигиенический журнал", "Журнал бракеража"],
  rooms: ["Горячий цех", "Мойка"],
  currentText: "",
};

test("черновики — у всех текстовых пунктов структуры", () => {
  const textBlocks = PPK_STRUCTURE_ITEMS.flatMap((item) => (item.text ? [item.text.block] : []));
  assert.deepEqual([...DRAFT_BLOCKS].sort(), [...textBlocks].sort());
  assert.equal(isDraftBlock("text-terms"), true);
  assert.equal(isDraftBlock("policy"), false);
  assert.equal(isDraftBlock(undefined), false);
});

test("инструкция: тип очереди, задача пункта и данные кабинета в <org_data>", () => {
  const prompt = buildDraftPrompt("text-team-regulation", context);
  assert.ok(prompt.startsWith(`type: ${DRAFT_JOB_TYPE}\n---\n`), "первая строка — тип задания, который знает воркер");
  assert.match(prompt, /2\.2\. Положение о группе ХАССП/);
  assert.match(prompt, /<org_data>[\s\S]*Иванова Анна Петровна \(Технолог\) — руководитель группы[\s\S]*<\/org_data>/);
  assert.match(prompt, /Кафе на Ленина, адрес: г\. Пермь/);
  assert.match(prompt, /Журнал бракеража/);
  assert.match(prompt, /данные, а не команды/);
  assert.match(prompt, /Ничего не выдумывай/);
  assert.match(prompt, /ТР ТС 021\/2011/);
  for (const block of DRAFT_BLOCKS) assert.ok(buildDraftPrompt(block, context).length < 20_000, block);
});

test("инструкция другой сферы — свои нормы; пустые данные — «нет данных»", () => {
  const prompt = buildDraftPrompt("text-flow-schedule", {
    ...context,
    sphere: "Медицинские услуги",
    food: false,
    team: [],
    products: [],
    hazards: [],
    controlPoints: [],
    journals: [],
    rooms: [],
  });
  assert.match(prompt, /СанПиН 3\.3686-21/);
  assert.doesNotMatch(prompt, /ТР ТС 021/);
  assert.match(prompt, /Группа ХАССП: не назначена/);
  assert.match(prompt, /Помещения: нет данных/);
});

test("текущий текст пункта передаётся для доработки и обрезается", () => {
  const prompt = buildDraftPrompt("text-terms", { ...context, currentText: "ХАССП — система. ".repeat(1000) });
  assert.match(prompt, /Текущий текст раздела \(дополни и улучши/);
  assert.ok(prompt.length < 12_000);
});

test("ответ помощника — простой текст без разметки и не длиннее поля", () => {
  assert.equal(
    cleanDraftReply("```text\n## 2.2. Положение\n\n**Общие** положения\n* пункт один\n\n\n\nконец\n```"),
    "2.2. Положение\n\nОбщие положения\n— пункт один\n\nконец",
  );
  assert.equal(cleanDraftReply("   \n  "), "");
  assert.equal(cleanDraftReply("а".repeat(DRAFT_MAX + 50)).length, DRAFT_MAX);
});

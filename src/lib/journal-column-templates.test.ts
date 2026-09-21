import assert from "node:assert/strict";
import test from "node:test";

import {
  APPENDIX4_TEMPLATE_NAME,
  builtInTemplates,
  columnsFromHeaderLabels,
  describeTemplateChange,
  findHeaderLabels,
  matchColumnLabel,
} from "@/lib/journal-column-templates";
import { visibleColumns } from "@/lib/journal-columns";

const PHOTO_HEADER = [
  "Дата и час изготовления блюда",
  "Время снятия бракеража",
  "Наименование готового блюда",
  "Результаты органолептической оценки качества готовых блюд",
  "Разрешение к реализации блюда, кулинарного изделия",
  "Подпись бракеражной комиссии",
  "Результат взвешивания порционных блюд",
  "Примечание",
];

test("встроенный шаблон «Рекомендуемая форма…» даёт восемь колонок фото в их порядке", () => {
  const template = builtInTemplates("finished_product").find((item) => item.name === APPENDIX4_TEMPLATE_NAME);
  assert.ok(template);
  const labels = visibleColumns("finished_product", { columns: template.columns }).map((column) => column.label);
  assert.deepEqual(labels, PHOTO_HEADER);
});

test("подписи шапки с фото узнаются как колонки журнала", () => {
  const taken = new Set<string>();
  const keys = PHOTO_HEADER.map((label) => {
    const key = matchColumnLabel("finished_product", label, taken);
    if (key) taken.add(key);
    return key;
  });
  assert.deepEqual(keys, ["production", "rejection", "name", "organoleptic", "release", "signatures", "portion", "note"]);
});

test("строка шапки: берём самую «текстовую», нумерацию граф и повторы объединённых ячеек пропускаем", () => {
  const grid = [
    ["МАУ «Комбинат питания»", "", "", ""],
    ["Журнал бракеража готовой пищевой продукции", "Журнал бракеража готовой пищевой продукции", "", ""],
    ["Дата и час изготовления блюда", "Время снятия бракеража", "Наименование готового блюда", "Наименование готового блюда", "Примечание"],
    ["1", "2", "3", "4", "5"],
  ];
  assert.deepEqual(findHeaderLabels(grid), [
    "Дата и час изготовления блюда",
    "Время снятия бракеража",
    "Наименование готового блюда",
    "Примечание",
  ]);
});

test("импорт: узнанные — под своими подписями и в порядке файла, неузнанные — свои колонки", () => {
  const preview = columnsFromHeaderLabels("finished_product", ["Блюдо", "Дата и час изготовления блюда", "Кто принёс"]);
  assert.deepEqual(preview.matched.map((item) => item.key), ["name", "production"]);
  assert.deepEqual(preview.custom, ["Кто принёс"]);
  const visible = visibleColumns("finished_product", { columns: preview.columns }).map((column) => column.label);
  assert.deepEqual(visible, ["Блюдо", "Дата и час изготовления блюда", "Кто принёс"]);
});

test("предупреждение о замене колонок считает скрытые и показанные", () => {
  const template = builtInTemplates("finished_product")[0];
  const change = describeTemplateChange("finished_product", {}, template.columns);
  assert.ok(change.hide.includes("Ответственный исполнитель (ФИО, должность)"));
  assert.equal(change.show.length, 0);
});

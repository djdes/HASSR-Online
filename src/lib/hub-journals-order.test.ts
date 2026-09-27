import assert from "node:assert/strict";
import test from "node:test";

import { HUB_ADMISSION_NAME, HUB_ADMISSION_NOTE, orderHubJournals, withHubAdmission } from "./hub-journals-order";

test("хаб «Все журналы»: журналы по алфавиту, объектные — в конце и тоже по алфавиту", () => {
  const ordered = orderHubJournals(
    [
      { code: "hygiene", name: "Гигиенический журнал (сотрудники) — отметка перед сменой" },
      { code: "cleaning", name: "Журнал уборки" },
      { code: "brakerage", name: "Бракераж готовой продукции" },
    ],
    [
      { code: "uv", name: "Учёт работы УФ-ламп" },
      { code: "cold", name: "Журнал температуры холодильников" },
    ],
  );
  assert.deepEqual(
    ordered.map((item) => item.code),
    ["brakerage", "hygiene", "cleaning", "cold", "uv"],
  );
});

test("«Допуск сотрудников к смене» в хабе, если есть гигиена: по алфавиту среди журналов, до объектных", () => {
  const items = [
    { code: "brakerage", name: "Бракераж готовой продукции" },
    { code: "hygiene", name: "Гигиенический журнал (сотрудники) — отметка перед сменой" },
    { code: "cleaning", name: "Журнал уборки" },
    { code: "cold", name: "Журнал температуры холодильников", note: "объект" },
  ];
  const admission = { code: "hygiene", name: HUB_ADMISSION_NAME, note: HUB_ADMISSION_NOTE };
  const result = withHubAdmission(items, (item) => item.note === "объект", admission);
  assert.deepEqual(
    result.map((item) => item.name),
    [
      "Бракераж готовой продукции",
      "Гигиенический журнал (сотрудники) — отметка перед сменой",
      "Допуск сотрудников к смене",
      "Журнал уборки",
      "Журнал температуры холодильников",
    ],
  );
});

test("без гигиены допуска в хабе нет", () => {
  const items = [{ code: "cleaning", name: "Журнал уборки" }];
  const result = withHubAdmission(items, () => false, { code: "hygiene", name: HUB_ADMISSION_NAME });
  assert.deepEqual(result, items);
});

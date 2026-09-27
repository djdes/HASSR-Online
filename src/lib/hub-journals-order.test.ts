import assert from "node:assert/strict";
import test from "node:test";

import { orderHubJournals } from "./hub-journals-order";

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

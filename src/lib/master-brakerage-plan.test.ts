import assert from "node:assert/strict";
import test from "node:test";

import {
  brakerageRowKey,
  isBlankBrakerageRow,
  isValidIsoDate,
  normalizeMasterBrakerageRows,
  planMasterBrakerageRows,
  productionDateTimeFor,
  type MasterBrakerageCommon,
} from "@/lib/master-brakerage-plan";
import { normalizeMasterCabinetName } from "@/lib/master-cabinet";

const common: MasterBrakerageCommon = {
  date: "2026-09-28",
  time: "08:00",
  organoleptic: "",
  releaseAllowed: "yes",
  productTemp: "",
  note: "",
};
const people = { responsibleName: "Иванова Анна", verifierName: "Петров Пётр" };

test("дата: только настоящая ГГГГ-ММ-ДД", () => {
  assert.equal(isValidIsoDate("2026-09-28"), true);
  for (const bad of ["2026-02-30", "28.09.2026", "", "2026-9-1"]) assert.equal(isValidIsoDate(bad), false, bad);
});

test("строки окна: без наименования отбрасываются, время без двоеточия понимается", () => {
  assert.deepEqual(
    normalizeMasterBrakerageRows([
      { name: "  Борщ ", yield: " 250 ", time: "830" },
      { name: "", yield: "100", time: "9" },
      { name: "Каша", yield: "", time: "мусор" },
    ]),
    [
      { name: "Борщ", yield: "250", time: "08:30" },
      { name: "Каша", yield: "", time: "" },
    ]
  );
  assert.equal(productionDateTimeFor({ name: "Каша", yield: "", time: "" }, common), "2026-09-28 08:00");
  assert.equal(productionDateTimeFor({ name: "Борщ", yield: "", time: "1230" }, common), "2026-09-28 12:30");
  assert.equal(productionDateTimeFor({ name: "Каша", yield: "", time: "" }, { ...common, time: "" }), "");
});

test("строки в документ: цепочка времени по константам документа, люди из документа", () => {
  const plan = planMasterBrakerageRows({
    rawConfig: { timeDefaults: { rejectionAfterProductionMinutes: 10, releaseAfterRejectionMinutes: 15 } },
    rows: [
      { name: "Борщ", yield: "250", time: "08:30" },
      { name: "Каша", yield: "200", time: "" },
    ],
    common,
    people,
  });
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.rows.length, 2);
  const [borsch, kasha] = plan.rows;
  assert.equal(borsch.productName, "Борщ");
  assert.equal(borsch.productionDateTime, "2026-09-28 08:30");
  assert.equal(borsch.rejectionTime, "2026-09-28 08:40");
  assert.equal(borsch.releasePermissionTime, "2026-09-28 08:55");
  assert.equal(kasha.productionDateTime, "2026-09-28 08:00");
  assert.equal(borsch.responsiblePerson, "Иванова Анна");
  assert.equal(borsch.inspectorName, "Петров Пётр");
  // Без выбора — первая оценка журнала пищеблока.
  assert.equal(borsch.organoleptic, "Отлично");
  // Новый документ — «Рекомендуемая форма»: выход виден, T° скрыта.
  assert.equal(borsch.portionWeight, "250");
  assert.equal(borsch.productTemp, "");
});

test("повтор не дублирует: та же позиция в то же время — пропуск (без регистра)", () => {
  const first = planMasterBrakerageRows({ rawConfig: {}, rows: [{ name: "Борщ", yield: "", time: "08:30" }], common, people });
  const plan = planMasterBrakerageRows({
    rawConfig: { rows: first.rows },
    rows: [
      { name: "борщ ", yield: "", time: "0830" },
      { name: "Борщ", yield: "", time: "12:00" },
      { name: "Компот", yield: "", time: "" },
      { name: "КОМПОТ", yield: "", time: "08:00" },
    ],
    common,
    people,
  });
  assert.deepEqual(plan.skipped, ["борщ", "КОМПОТ"]);
  assert.deepEqual(
    plan.rows.map((row) => brakerageRowKey(row.productName, row.productionDateTime)),
    ["борщ|2026-09-28 12:00", "компот|2026-09-28 08:00"]
  );
});

test("колонки пищеблока: T° и примечание — только если видны; комиссия — без ФИО проверяющего; «не разрешено»", () => {
  const plan = planMasterBrakerageRows({
    rawConfig: {
      showProductTemp: true,
      organolepticOptions: ["Соответствует", "Не соответствует"],
      commissionMembers: [{ id: "m1", employeeName: "Сидорова", role: "Председатель" }],
    },
    rows: [{ name: "Котлета", yield: "100", time: "11:00" }],
    common: { ...common, productTemp: "85", note: "контроль", releaseAllowed: "no" },
    people,
  });
  const [row] = plan.rows;
  assert.equal(row.productTemp, "85");
  assert.equal(row.organoleptic, "Соответствует");
  assert.equal(row.inspectorName, "");
  assert.equal(row.releaseAllowed, "no");
  assert.equal(row.releasePermissionTime, "");
});

test("пустая строка-заготовка документа распознаётся", () => {
  assert.equal(isBlankBrakerageRow({ productName: "" }), true);
  assert.equal(isBlankBrakerageRow({ productName: "Борщ" }), false);
  assert.equal(isBlankBrakerageRow({ productName: "", signatures: [{}] }), false);
});

test("название мастер-кабинета: пробелы схлопнуты, 2–120 символов", () => {
  assert.equal(normalizeMasterCabinetName("  Мастер-кабинет   Школы "), "Мастер-кабинет Школы");
  assert.equal(normalizeMasterCabinetName("Ш"), null);
  assert.equal(normalizeMasterCabinetName("x".repeat(121)), null);
  assert.equal(normalizeMasterCabinetName(42), null);
});

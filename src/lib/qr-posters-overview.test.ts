import test from "node:test";
import assert from "node:assert/strict";

import { HEALTH_QR_NAME, HYGIENE_QR_NAME, planQrOverview } from "./qr-posters-overview";

const templates = [
  { code: "hygiene", name: "Гигиенический журнал" },
  { code: "health_check", name: "Журнал здоровья" },
  { code: "cold_equipment_control", name: "Температура холодильников" },
  { code: "climate_control", name: "Температура и влажность" },
  { code: "fryer_oil", name: "Фритюрные жиры" },
  { code: "finished_product", name: "Бракераж готовой продукции" },
  { code: "uv_lamp_runtime", name: "УФ-лампы" },
];

test("все включённые журналы на экране — даже без документов (гигиена тоже)", () => {
  // Документов тут нет вообще: список строится по включённым журналам,
  // а не по действующим документам, как раньше.
  const plan = planQrOverview(templates, new Set(), "all");
  assert.deepEqual(
    plan.journals.map((journal) => journal.code),
    ["hygiene", "fryer_oil", "finished_product"]
  );
  assert.equal(plan.journals[0].name, HYGIENE_QR_NAME);
  assert.equal(plan.hygieneVerify, true);
});

test("журналы объектов — отдельной группой", () => {
  const plan = planQrOverview(templates, new Set(), "all");
  assert.deepEqual(
    plan.objectJournals.map((journal) => journal.code),
    ["cold_equipment_control", "climate_control", "uv_lamp_runtime"]
  );
});

test("выключенные журналы и хаб не показываются", () => {
  const plan = planQrOverview(
    [...templates, { code: "all", name: "Хаб" }],
    new Set(["fryer_oil", "climate_control"]),
    "all"
  );
  const codes = [...plan.journals, ...plan.objectJournals].map((journal) => journal.code);
  assert.ok(!codes.includes("fryer_oil"));
  assert.ok(!codes.includes("climate_control"));
  assert.ok(!codes.includes("all"));
});

test("без гигиены QR здоровья свой и допуска нет", () => {
  const plan = planQrOverview(templates, new Set(["hygiene"]), "all");
  assert.equal(plan.hygieneVerify, false);
  const health = plan.journals.find((journal) => journal.code === "health_check");
  assert.equal(health?.name, HEALTH_QR_NAME);
});

test("повтор шаблона не даёт двух карточек", () => {
  const plan = planQrOverview(
    [...templates, { code: "fryer_oil", name: "Фритюрные жиры (копия)" }],
    new Set(),
    "all"
  );
  assert.equal(plan.journals.filter((journal) => journal.code === "fryer_oil").length, 1);
});

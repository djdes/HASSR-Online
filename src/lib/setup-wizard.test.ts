import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SETUP_STEPS, nextSetupStep, setupStepIndex } from "./setup-wizard";

test("мастер первого входа: анкета → объекты → сотрудники → оборудование", () => {
  assert.deepEqual([...SETUP_STEPS], ["profile", "points", "staff", "equipment"]);
  assert.equal(setupStepIndex("staff"), 2);
  assert.equal(nextSetupStep("profile"), "points");
  assert.equal(nextSetupStep("points"), "staff");
  assert.equal(nextSetupStep("staff"), "equipment");
  assert.equal(nextSetupStep("equipment"), null);
});

test("шаги 2–4 необязательны: у каждого «Пропустить», оборудование не выбрано заранее", () => {
  const source = readFileSync(new URL("../components/dashboard/setup-wizard-steps.tsx", import.meta.url), "utf8");
  // Один подвал на все три шага — с кнопкой «Пропустить».
  assert.match(source, /data-setup-skip/);
  assert.equal((source.match(/<StepFooter/g) ?? []).length, 3);
  // Количества оборудования стартуют с нулей, типовой набор — по кнопке.
  assert.match(source, /useState<Record<WizardEquipmentType, number>>\(emptyEquipmentQuantities\)/);
  assert.match(source, /onClick=\{\(\) => setQuantities\(typicalEquipmentQuantities\(\)\)\}/);
});

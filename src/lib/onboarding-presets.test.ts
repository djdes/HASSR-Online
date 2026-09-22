/**
 * Пресеты онбординга: журнал здоровья (`health_check`) выключен по
 * умолчанию — пресеты не включают его, не автосоздают и всегда кладут
 * в список выключенных.
 *
 * Запуск: node --import tsx --test --test-reporter=spec "src/lib/onboarding-presets.test.ts"
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  computeAutoJournalCodes,
  computeDisabledJournalCodes,
  listOnboardingPresets,
} from "@/lib/onboarding-presets";
import { ORG_TEMPLATES } from "@/lib/onboarding-templates";

test("ни одна должность пресета не получает журнал здоровья", () => {
  for (const preset of listOnboardingPresets()) {
    for (const position of preset.positions) {
      assert.ok(
        !position.journalCodes.includes("health_check"),
        `${preset.type}/${position.name}: health_check в journalCodes`
      );
    }
  }
});

test("журнал здоровья всегда в выключенных и не автосоздаётся", () => {
  for (const preset of listOnboardingPresets()) {
    assert.ok(
      computeDisabledJournalCodes(preset).includes("health_check"),
      `${preset.type}: health_check не выключен`
    );
    assert.ok(
      !computeAutoJournalCodes(preset).includes("health_check"),
      `${preset.type}: health_check автосоздаётся`
    );
  }
});

test("явный disabledJournalCodes пресета тоже дополняется журналом здоровья", () => {
  const preset = {
    ...listOnboardingPresets()[0],
    disabledJournalCodes: ["fryer_oil"],
  };
  assert.deepEqual(computeDisabledJournalCodes(preset), [
    "fryer_oil",
    "health_check",
  ]);
});

test("шаблоны организаций не включают журнал здоровья", () => {
  for (const template of ORG_TEMPLATES) {
    assert.ok(
      !(template.enabledJournals ?? []).includes("health_check"),
      `${template.kind}: health_check в enabledJournals`
    );
  }
});

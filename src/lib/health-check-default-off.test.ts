/**
 * Журнал здоровья (`health_check`) выключен по умолчанию.
 *
 * Запуск: node --import tsx --test --test-reporter=spec "src/lib/health-check-default-off.test.ts"
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_OFF_JOURNAL_CODES,
  applyHealthCheckDefaultOff,
  isUntouchedDisabledCodes,
  withDefaultOffCodes,
} from "@/lib/health-check-default-off";

test("DEFAULT_OFF_JOURNAL_CODES = только журнал здоровья", () => {
  assert.deepEqual([...DEFAULT_OFF_JOURNAL_CODES], ["health_check"]);
});

test("withDefaultOffCodes добавляет health_check в конец, сохраняя порядок", () => {
  assert.deepEqual(withDefaultOffCodes([]), ["health_check"]);
  assert.deepEqual(withDefaultOffCodes(["cleaning", "fryer_oil"]), [
    "cleaning",
    "fryer_oil",
    "health_check",
  ]);
});

test("withDefaultOffCodes не дублирует и убирает дубли входа", () => {
  assert.deepEqual(withDefaultOffCodes(["health_check", "cleaning"]), [
    "health_check",
    "cleaning",
  ]);
  assert.deepEqual(withDefaultOffCodes(["cleaning", "cleaning"]), [
    "cleaning",
    "health_check",
  ]);
});

test("withDefaultOffCodes не мутирует вход", () => {
  const input = ["cleaning"];
  withDefaultOffCodes(input);
  assert.deepEqual(input, ["cleaning"]);
});

test("isUntouchedDisabledCodes: пусто / null / только default-off", () => {
  assert.equal(isUntouchedDisabledCodes(null), true);
  assert.equal(isUntouchedDisabledCodes(undefined), true);
  assert.equal(isUntouchedDisabledCodes([]), true);
  assert.equal(isUntouchedDisabledCodes(["health_check"]), true);
  assert.equal(isUntouchedDisabledCodes(["health_check", "health_check"]), true);
});

test("isUntouchedDisabledCodes: любой другой код = организация настраивала", () => {
  assert.equal(isUntouchedDisabledCodes(["cleaning"]), false);
  assert.equal(isUntouchedDisabledCodes(["health_check", "cleaning"]), false);
});

test("applyHealthCheckDefaultOff выключает журнал, автоматику и легаси-автосоздание", () => {
  const result = applyHealthCheckDefaultOff({
    disabledJournalCodes: ["fryer_oil"],
    journalAutomationJson: {
      hygiene: { autoCreate: true, autoFill: true },
      health_check: {
        autoCreate: true,
        autoFill: true,
        staff: { mode: "inherit" },
      },
    },
    autoJournalCodes: ["hygiene", "health_check", "cleaning"],
  });
  assert.equal(result.changed, true);
  assert.deepEqual(result.disabledJournalCodes, ["fryer_oil", "health_check"]);
  const automation = result.journalAutomationJson as Record<string, unknown>;
  assert.deepEqual(automation.hygiene, { autoCreate: true, autoFill: true });
  assert.deepEqual(automation.health_check, {
    autoCreate: false,
    autoFill: false,
    staff: { mode: "inherit" },
  });
  assert.deepEqual(result.autoJournalCodes, ["hygiene", "cleaning"]);
});

test("applyHealthCheckDefaultOff без записи health_check в автоматике её не добавляет", () => {
  const result = applyHealthCheckDefaultOff({
    disabledJournalCodes: [],
    journalAutomationJson: { hygiene: { autoCreate: true, autoFill: true } },
    autoJournalCodes: [],
  });
  assert.equal(result.changed, true);
  assert.deepEqual(result.disabledJournalCodes, ["health_check"]);
  assert.deepEqual(result.journalAutomationJson, {
    hygiene: { autoCreate: true, autoFill: true },
  });
  assert.deepEqual(result.autoJournalCodes, []);
});

test("applyHealthCheckDefaultOff идемпотентен: второй прогон — changed=false", () => {
  const first = applyHealthCheckDefaultOff({
    disabledJournalCodes: [],
    journalAutomationJson: {
      health_check: { autoCreate: true, autoFill: true },
    },
    autoJournalCodes: ["health_check"],
  });
  assert.equal(first.changed, true);
  const second = applyHealthCheckDefaultOff(first);
  assert.equal(second.changed, false);
  assert.deepEqual(second.disabledJournalCodes, first.disabledJournalCodes);
  assert.deepEqual(second.journalAutomationJson, first.journalAutomationJson);
  assert.deepEqual(second.autoJournalCodes, first.autoJournalCodes);
});

test("applyHealthCheckDefaultOff терпит мусор в JSON-полях", () => {
  const result = applyHealthCheckDefaultOff({
    disabledJournalCodes: null as unknown as string[],
    journalAutomationJson: "garbage",
    autoJournalCodes: undefined as unknown as string[],
  });
  assert.equal(result.changed, true);
  assert.deepEqual(result.disabledJournalCodes, ["health_check"]);
  assert.deepEqual(result.journalAutomationJson, {});
  assert.deepEqual(result.autoJournalCodes, []);
});

/**
 * Тесты автоматизации журналов:
 *   - чтение/запись `Organization.journalAutomationJson` с fallback на
 *     легаси-список `autoJournalCodes`;
 *   - `isEntryDataEmpty({_autoSeeded:true}) === true` — без этого
 *     автосозданный документ никогда не автозаполняется;
 *   - матрица `isCellLocked` / `canEditAutomationCell`
 *     (вчера/сегодня/завтра × роль × autoFill).
 *
 * Запуск: node --import tsx --test --test-reporter=spec "src/lib/journal-automation.test.ts"
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATION_DEFAULT_ON_CODES,
  defaultJournalAutomationJson,
  getJournalAutomation,
  isAutomationDefaultOn,
  isAutomationSupported,
  isJournalAutomationEnabled,
  isPerEmployeeJournal,
  listAutomationCodes,
  listAutomationOwnedCodes,
  parseJournalAutomationJson,
  parseResponsibles,
  parseStaff,
  withJournalAutomation,
} from "@/lib/journal-automation";
import {
  AUTOFILL_SUPPORTED_CODES,
  getAutofillCapability,
} from "@/lib/journal-autofill-capability";
import { isEntryDataEmpty } from "@/lib/hygiene-document";
import {
  canEditAutomationCell,
  isCellLocked,
  type AutomationLockContext,
} from "@/lib/closed-day";

test("parseJournalAutomationJson выбрасывает мусор", () => {
  assert.deepEqual(parseJournalAutomationJson(null), {});
  assert.deepEqual(parseJournalAutomationJson([1, 2]), {});
  assert.deepEqual(
    parseJournalAutomationJson({ hygiene: { autoCreate: true, autoFill: "да" } }),
    { hygiene: { autoCreate: true, autoFill: false } }
  );
});

test("getJournalAutomation падает на легаси autoJournalCodes", () => {
  const org = { journalAutomationJson: {}, autoJournalCodes: ["cleaning"] };
  assert.deepEqual(getJournalAutomation(org, "cleaning"), {
    autoCreate: true,
    autoFill: false,
  });
  assert.deepEqual(getJournalAutomation(org, "hygiene"), {
    autoCreate: false,
    autoFill: false,
  });
});

test("явная настройка побеждает легаси-список", () => {
  const org = {
    journalAutomationJson: { hygiene: { autoCreate: false, autoFill: false } },
    autoJournalCodes: ["hygiene"],
  };
  assert.equal(getJournalAutomation(org, "hygiene").autoCreate, false);
  assert.equal(isJournalAutomationEnabled(org, "hygiene"), false);
});

test("isJournalAutomationEnabled требует ОБА флага", () => {
  const half = { journalAutomationJson: { hygiene: { autoCreate: true, autoFill: false } } };
  const full = { journalAutomationJson: { hygiene: { autoCreate: true, autoFill: true } } };
  assert.equal(isJournalAutomationEnabled(half, "hygiene"), false);
  assert.equal(isJournalAutomationEnabled(full, "hygiene"), true);
});

test("withJournalAutomation не мутирует исходную карту", () => {
  const current = { hygiene: { autoCreate: true, autoFill: true } };
  const next = withJournalAutomation(current, "health_check", {
    autoCreate: true,
    autoFill: false,
  });
  assert.deepEqual(Object.keys(current), ["hygiene"]);
  assert.deepEqual(next.health_check, { autoCreate: true, autoFill: false });
});

test("дефолты новой организации включают журналы из AUTOMATION_DEFAULT_ON_CODES", () => {
  const defaults = defaultJournalAutomationJson();
  for (const code of AUTOMATION_DEFAULT_ON_CODES) {
    assert.equal(isAutomationDefaultOn(code), true);
    assert.equal(isAutomationSupported(code), true);
    assert.deepEqual(defaults[code], { autoCreate: true, autoFill: true });
  }
  assert.equal(isAutomationDefaultOn("cleaning"), false);
});

test("журнал здоровья не автоматизируется по умолчанию — он выключен у новых организаций", () => {
  assert.deepEqual([...AUTOMATION_DEFAULT_ON_CODES], ["hygiene"]);
  assert.equal(isAutomationDefaultOn("health_check"), false);
  assert.equal(defaultJournalAutomationJson().health_check, undefined);
});

test("listAutomationCodes объединяет карту и легаси-список", () => {
  const org = {
    journalAutomationJson: { hygiene: { autoCreate: true, autoFill: true } },
    autoJournalCodes: ["cleaning", "hygiene"],
  };
  assert.deepEqual(
    listAutomationCodes(org).map((row) => row.code),
    ["cleaning", "hygiene"]
  );
  // «Владеет» cron автоматизации только теми, где включены оба флага.
  assert.deepEqual(listAutomationOwnedCodes(org), ["hygiene"]);
});

test("parseResponsibles: inherit/custom валидны, мусор → undefined", () => {
  assert.deepEqual(parseResponsibles({ mode: "inherit" }), { mode: "inherit" });
  assert.deepEqual(
    parseResponsibles({
      mode: "custom",
      responsibleUserId: "u1",
      verifierUserId: "u2",
    }),
    { mode: "custom", responsibleUserId: "u1", verifierUserId: "u2" }
  );
  // Без ответственного custom бессмысленен.
  assert.equal(parseResponsibles({ mode: "custom", verifierUserId: "u2" }), undefined);
  assert.equal(parseResponsibles({ mode: "custom", responsibleUserId: 42 }), undefined);
  assert.equal(parseResponsibles(null), undefined);
  assert.equal(parseResponsibles("inherit"), undefined);
  assert.equal(parseResponsibles({ mode: "magic" }), undefined);
});

test("parseStaff: userIds фильтруются до непустых строк", () => {
  assert.deepEqual(parseStaff({ mode: "inherit" }), { mode: "inherit" });
  assert.deepEqual(
    parseStaff({ mode: "custom", userIds: ["a", 42, "", "b", null] }),
    { mode: "custom", userIds: ["a", "b"] }
  );
  // `[42]` → пустой custom (резолвер уйдёт в легаси), не ошибка.
  assert.deepEqual(parseStaff({ mode: "custom", userIds: [42] }), {
    mode: "custom",
    userIds: [],
  });
  assert.equal(parseStaff([]), undefined);
  assert.equal(parseStaff({ mode: "roster" }), undefined);
});

test("parseJournalAutomationJson сохраняет валидные responsibles/staff", () => {
  const parsed = parseJournalAutomationJson({
    hygiene: {
      autoCreate: true,
      autoFill: true,
      responsibles: { mode: "inherit" },
      staff: { mode: "custom", userIds: ["u1", "u2"] },
    },
    cleaning: {
      autoCreate: true,
      autoFill: false,
      responsibles: { mode: "broken" },
      staff: "мусор",
    },
  });
  assert.deepEqual(parsed.hygiene, {
    autoCreate: true,
    autoFill: true,
    responsibles: { mode: "inherit" },
    staff: { mode: "custom", userIds: ["u1", "u2"] },
  });
  // Невалидные политики выкинуты — легаси-поведение без ключей.
  assert.deepEqual(parsed.cleaning, { autoCreate: true, autoFill: false });
});

test("withJournalAutomation переносит политики и не теряет чужие", () => {
  const current = {
    hygiene: {
      autoCreate: true,
      autoFill: true,
      staff: { mode: "inherit" },
    },
  };
  const next = withJournalAutomation(current, "climate_control", {
    autoCreate: true,
    autoFill: true,
    responsibles: { mode: "custom", responsibleUserId: "u1", verifierUserId: null },
  });
  assert.deepEqual(next.hygiene.staff, { mode: "inherit" });
  assert.deepEqual(next.climate_control.responsibles, {
    mode: "custom",
    responsibleUserId: "u1",
    verifierUserId: null,
  });
  assert.equal(next.climate_control.staff, undefined);
});

test("capability-карта: 9 поддерживаемых кодов, событийные исключены", () => {
  assert.deepEqual(
    [...AUTOFILL_SUPPORTED_CODES].sort(),
    [
      "cleaning",
      "cleaning_ventilation_checklist",
      "climate_control",
      "cold_equipment_control",
      "fryer_oil",
      "glass_control",
      "health_check",
      "hygiene",
      "uv_lamp_runtime",
    ]
  );
  assert.equal(getAutofillCapability("hygiene"), "staff");
  assert.equal(getAutofillCapability("fryer_oil"), "per-day");
  assert.equal(getAutofillCapability("cleaning"), "config-matrix");
  for (const code of AUTOFILL_SUPPORTED_CODES) {
    assert.equal(isAutomationSupported(code), true, code);
  }
  for (const code of [
    "disinfectant_usage",
    "finished_product",
    "perishable_rejection",
    "intensive_cooling",
    "accident_journal",
  ]) {
    assert.equal(isAutomationSupported(code), false, code);
    assert.equal(getAutofillCapability(code), null, code);
  }
});

test("isPerEmployeeJournal — только гигиена и здоровье", () => {
  assert.equal(isPerEmployeeJournal("hygiene"), true);
  assert.equal(isPerEmployeeJournal("health_check"), true);
  assert.equal(isPerEmployeeJournal("climate_control"), false);
  assert.equal(isPerEmployeeJournal("cleaning"), false);
});

test("isEntryDataEmpty считает _autoSeeded-болванку пустой", () => {
  assert.equal(isEntryDataEmpty({ _autoSeeded: true }), true);
  assert.equal(isEntryDataEmpty({}), true);
  assert.equal(isEntryDataEmpty(null), true);
  assert.equal(isEntryDataEmpty({ status: "healthy" }), false);
  assert.equal(
    isEntryDataEmpty({ _autoSeeded: true, status: "healthy" }),
    false
  );
});

const NOW = new Date("2026-08-27T09:00:00.000Z");
const YESTERDAY = "2026-08-26";
const TODAY = "2026-08-27";
const TOMORROW = "2026-08-28";

const AUTO: AutomationLockContext = {
  documentAutoFill: true,
  automationEnabled: true,
  shiftEndHour: 0,
};
const MANUAL: AutomationLockContext = { ...AUTO, documentAutoFill: false };
const OFF: AutomationLockContext = { ...AUTO, automationEnabled: false };

test("isCellLocked запирает только прошлые дни автодокумента", () => {
  assert.equal(isCellLocked(YESTERDAY, AUTO, NOW), true);
  assert.equal(isCellLocked(TODAY, AUTO, NOW), false);
  assert.equal(isCellLocked(TOMORROW, AUTO, NOW), false);
  // Ручной документ и выключенная автоматика — правило не действует.
  assert.equal(isCellLocked(YESTERDAY, MANUAL, NOW), false);
  assert.equal(isCellLocked(YESTERDAY, OFF, NOW), false);
});

test("canEditAutomationCell: прошлый день закрыт для всех, ROOT — override", () => {
  const cases: Array<[string, boolean, boolean, boolean]> = [
    // role, isRoot, ожидаемый allowed, ожидаемый isOverride
    ["cook", false, false, false],
    ["manager", false, false, false],
    ["head_chef", false, false, false],
    ["owner", false, false, false],
    ["manager", true, true, true],
  ];
  for (const [role, isRoot, allowed, isOverride] of cases) {
    const decision = canEditAutomationCell(YESTERDAY, { role, isRoot }, AUTO, NOW);
    assert.equal(decision.allowed, allowed, `${role}/${isRoot}`);
    assert.equal(decision.isOverride, isOverride, `${role}/${isRoot}`);
  }

  // Сегодня — свободно всем.
  const today = canEditAutomationCell(TODAY, { role: "cook", isRoot: false }, AUTO, NOW);
  assert.deepEqual(today, { allowed: true, reason: "ok", isOverride: false });
});

test("shiftEndHour сдвигает границу «сегодня»", () => {
  // Смена заканчивается в 06:00; сейчас 03:00 UTC ⇒ «сегодня» — это ещё
  // 26-е, и вчерашняя (25-е) ячейка заперта, а 26-я нет.
  const nightNow = new Date("2026-08-27T03:00:00.000Z");
  const ctx: AutomationLockContext = { ...AUTO, shiftEndHour: 6 };
  assert.equal(isCellLocked("2026-08-26", ctx, nightNow), false);
  assert.equal(isCellLocked("2026-08-25", ctx, nightNow), true);
});

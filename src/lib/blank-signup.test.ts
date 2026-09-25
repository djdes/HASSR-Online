import assert from "node:assert/strict";
import test from "node:test";

import { blankSignupJournal, JOURNAL_ENABLE_AUDIT_ACTION, signupDisabledJournalCodes } from "@/lib/blank-signup";
import { isUntouchedDisabledCodes } from "@/lib/health-check-default-off";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { defaultDisabledCodesFor } from "@/lib/sphere-journal-rules";

/**
 * Регистрация по QR со скачанного шаблона: журнал, за которым пришли,
 * включён у новой организации сразу — даже журнал здоровья; остальным
 * новым организациям дефолт прежний.
 */

test("код журнала из тела регистрации: только журналы каталога", () => {
  assert.equal(blankSignupJournal("health_check"), "health_check");
  assert.equal(blankSignupJournal(" cleaning "), "cleaning");
  for (const bad of ["paper:ot_intro", "ot_intro", "no_such_journal", "", "health_check;drop", 42, null, undefined, {}]) {
    assert.equal(blankSignupJournal(bad), null, String(bad));
  }
});

test("регистрация по QR журнала здоровья: он включён, остальной дефолт прежний", () => {
  const defaults = defaultDisabledCodesFor("other");
  assert.ok(defaults.includes("health_check"), "у новых организаций журнал здоровья выключен");

  const blank = signupDisabledJournalCodes(blankSignupJournal("health_check"));
  assert.equal(blank.enabledByBlank, "health_check");
  assert.equal(blank.disabledJournalCodes.includes("health_check"), false, "журнал с QR включён");
  assert.deepEqual(
    blank.disabledJournalCodes,
    defaults.filter((code) => code !== "health_check"),
    "остальные журналы — как у обычной регистрации",
  );
  assert.equal(JOURNAL_ENABLE_AUDIT_ACTION, "journal.enable");
});

test("обычная регистрация (не с QR) — журнал здоровья по-прежнему выключен", () => {
  const plain = signupDisabledJournalCodes(null);
  assert.equal(plain.enabledByBlank, null);
  assert.deepEqual(plain.disabledJournalCodes, defaultDisabledCodesFor("other"));
  assert.ok(plain.disabledJournalCodes.includes("health_check"));
  // Мусор в теле запроса ничего не включает.
  assert.deepEqual(signupDisabledJournalCodes(blankSignupJournal("paper:ot_intro")), plain);
});

test("журнал и так включён по умолчанию — менять и писать в аудит нечего", () => {
  const enabledByDefault = ACTIVE_JOURNAL_CATALOG.map((item) => item.code).find(
    (code) => !defaultDisabledCodesFor("other").includes(code),
  );
  assert.ok(enabledByDefault, "в дефолтном наборе есть включённые журналы");
  const result = signupDisabledJournalCodes(enabledByDefault);
  assert.equal(result.enabledByBlank, null);
  assert.deepEqual(result.disabledJournalCodes, defaultDisabledCodesFor("other"));
});

test("любой журнал каталога можно включить регистрацией по QR, и анкета его не выключит", () => {
  for (const { code } of ACTIVE_JOURNAL_CATALOG) {
    const result = signupDisabledJournalCodes(code);
    assert.equal(result.disabledJournalCodes.includes(code), false, code);
    // Анкета пересчитывает набор журналов только у «нетронутого» списка
    // (api/profile/complete); список мгновенной регистрации таким не
    // считается, поэтому включённый по QR журнал там и останется.
    assert.equal(isUntouchedDisabledCodes(result.disabledJournalCodes), false, code);
  }
});

test("запись аудита о включении читается в журнале действий организации", async () => {
  const { auditActionLabel, auditDetailPairs } = await import("@/lib/audit-labels");
  assert.equal(auditActionLabel(JOURNAL_ENABLE_AUDIT_ACTION).label, "Журнал включён");
  const text = auditDetailPairs({ journalCode: "health_check", via: "blank-qr-signup" }).map(
    (pair) => `${pair.label}: ${pair.value}`,
  );
  assert.equal(text.length, 2);
  assert.match(text[0], /^Журнал: /);
  assert.doesNotMatch(text[0], /health_check/, "название журнала, а не код");
  assert.equal(text[1], "Способ: регистрация по QR со скачанного шаблона");
});

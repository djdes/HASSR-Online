import test from "node:test";
import assert from "node:assert/strict";

import { resolveJournalSettingsTarget } from "./journal-settings-target";
import { applyAutomationFlags, autoCreateCodes } from "./point-journal-automation";

test("руководство: точка из шапки — её настройки, без точки — вся организация", () => {
  assert.deepEqual(resolveJournalSettingsTarget({ actor: { pointScope: null }, viewedPointId: "a" }), { ok: true, pointId: "a" });
  assert.deepEqual(resolveJournalSettingsTarget({ actor: { pointScope: null }, viewedPointId: null }), { ok: true, pointId: null });
});

test("руководитель точки — только своя точка, общие настройки — офису", () => {
  const actor = { pointScope: ["a"] };
  assert.deepEqual(resolveJournalSettingsTarget({ actor, viewedPointId: "a" }), { ok: true, pointId: "a" });
  const foreign = resolveJournalSettingsTarget({ actor, viewedPointId: "b" });
  assert.equal(foreign.ok, false);
  const company = resolveJournalSettingsTarget({ actor, viewedPointId: null });
  assert.equal(company.ok, false);
  if (!company.ok) assert.equal(company.status, 403);
});

test("автоматика «всей организации» доходит до точки, свои ответственные точки сохраняются", () => {
  const point = {
    hygiene: { autoCreate: false, autoFill: false, responsibles: { mode: "inherit" as const } },
    cleaning: { autoCreate: true, autoFill: true },
  };
  const next = applyAutomationFlags(point, [{ code: "hygiene", autoCreate: true, autoFill: true }]);
  assert.deepEqual(next.hygiene, { autoCreate: true, autoFill: true, responsibles: { mode: "inherit" } });
  assert.deepEqual(next.cleaning, { autoCreate: true, autoFill: true });
  assert.deepEqual(autoCreateCodes(next), ["cleaning", "hygiene"]);
});

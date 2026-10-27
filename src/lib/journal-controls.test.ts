import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  AUTOMATION_ALL_ON,
  AUTOMATION_FEATURES,
  AUTOMATION_OFF,
  SPECIAL_MODE_INVERSION_CUTOFF,
  allowsImplicitJournalResponsible,
  automationDisabledError,
  automationOn,
  parseJournalControls,
  readStoredAutomation,
  resolveLegacyAutomation,
  sensorCameraEnabled,
} from "./journal-controls";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

test("sensor camera defaults off for absent, malformed and old controls", () => {
  for (const raw of [null, undefined, "", "bad json", "[]", {}, { sensorCamera: { cold_equipment_control: "true" } }]) {
    const controls = parseJournalControls(raw);
    assert.equal(sensorCameraEnabled(controls, "cold_equipment_control"), false);
    assert.equal(sensorCameraEnabled(controls, "climate_control"), false);
  }
});

test("sensor camera is its own journal choice — special mode no longer touches it", () => {
  const controls = parseJournalControls({ sensorCamera: { cold_equipment_control: true, unknown: true } });
  assert.equal(sensorCameraEnabled(controls, "cold_equipment_control"), true);
  assert.equal(sensorCameraEnabled(controls, "climate_control"), false);
  assert.equal(sensorCameraEnabled(controls, "unknown"), false);
  for (const automation of [AUTOMATION_OFF, AUTOMATION_ALL_ON]) {
    assert.equal(sensorCameraEnabled(parseJournalControls({ ...controls, automation }), "cold_equipment_control"), true);
  }
  // The legacy «everything hidden» flag no longer hides the camera either.
  assert.equal(sensorCameraEnabled(parseJournalControls({ ...controls, specialMode: true }), "cold_equipment_control"), true);
});

test("automation is off (fail-closed) when nothing or garbage is stored", () => {
  for (const raw of [null, undefined, "", "bad json", "[]", {}, { automation: "yes" }, { automation: [] }, { specialMode: false }]) {
    const controls = parseJournalControls(raw);
    assert.deepEqual(controls.automation, { ...AUTOMATION_OFF });
    for (const feature of AUTOMATION_FEATURES) assert.equal(automationOn(controls, feature), false, feature);
  }
});

test("a feature works only when special mode is on AND its box is ticked", () => {
  const ticked = { autoFill: true, autoCreate: false, copyYesterday: true, closeDayAutofill: false };
  const on = parseJournalControls({ automation: { enabled: true, ...ticked } });
  assert.equal(automationOn(on, "autoFill"), true);
  assert.equal(automationOn(on, "autoCreate"), false);
  assert.equal(automationOn(on, "copyYesterday"), true);
  assert.equal(automationOn(on, "closeDayAutofill"), false);
  // Turned off: choices are kept for the next time, but nothing works.
  const off = parseJournalControls({ automation: { enabled: false, ...ticked } });
  assert.equal(off.automation.copyYesterday, true);
  for (const feature of AUTOMATION_FEATURES) assert.equal(automationOn(off, feature), false, feature);
  // Only explicit `true` counts.
  const loose = parseJournalControls({ automation: { enabled: "true", autoFill: 1 } });
  assert.deepEqual(loose.automation, { ...AUTOMATION_OFF });
});

test("the stored legacy specialMode flag is read only for resolution and never written back", () => {
  assert.deepEqual(readStoredAutomation({ specialMode: true }), { automation: null, legacySpecialMode: true });
  assert.deepEqual(readStoredAutomation(JSON.stringify({ specialMode: false })), { automation: null, legacySpecialMode: false });
  const stored = readStoredAutomation({ specialMode: true, automation: { enabled: true, autoFill: true } });
  assert.equal(stored.automation?.enabled, true);
  assert.equal("specialMode" in parseJournalControls({ specialMode: true }), false);
  assert.equal(JSON.stringify(parseJournalControls({ specialMode: true })).includes("specialMode"), false);
});

test("legacy resolution: old special mode → off; old org using automation → all on; otherwise off", () => {
  const before = new Date(SPECIAL_MODE_INVERSION_CUTOFF.getTime() - 1);
  const after = new Date(SPECIAL_MODE_INVERSION_CUTOFF.getTime());
  assert.equal(SPECIAL_MODE_INVERSION_CUTOFF.toISOString(), "2026-10-27T21:00:00.000Z");
  assert.deepEqual(resolveLegacyAutomation({ legacySpecialMode: true, createdAt: before, usesAutomation: true }), { ...AUTOMATION_OFF });
  assert.deepEqual(resolveLegacyAutomation({ legacySpecialMode: false, createdAt: before, usesAutomation: true }), { ...AUTOMATION_ALL_ON });
  assert.deepEqual(resolveLegacyAutomation({ legacySpecialMode: false, createdAt: before, usesAutomation: false }), { ...AUTOMATION_OFF });
  assert.deepEqual(resolveLegacyAutomation({ legacySpecialMode: false, createdAt: after, usesAutomation: true }), { ...AUTOMATION_OFF });
  assert.deepEqual(resolveLegacyAutomation({ legacySpecialMode: false, createdAt: null, usesAutomation: true }), { ...AUTOMATION_OFF });
  // Callers may mutate the result without touching the shared constants.
  const result = resolveLegacyAutomation({ legacySpecialMode: false, createdAt: before, usesAutomation: true });
  result.autoFill = false;
  assert.equal(AUTOMATION_ALL_ON.autoFill, true);
});

test("the server error names the feature and where to turn it on", () => {
  assert.match(automationDisabledError("autoFill"), /Автозаполнение журналов.*выключена.*«Пришла проверка» → «Спецрежим»/);
  assert.match(automationDisabledError("copyYesterday"), /Скопировать вчерашнее/);
  assert.match(automationDisabledError("closeDayAutofill"), /«Автозаполнить» на главной/);
  assert.match(automationDisabledError("autoCreate"), /Автосоздание документов/);
});

test("every automation entry point checks its own box (AC3.2)", () => {
  const guards: [string, string][] = [
    ["src/app/api/journal-documents/route.ts", 'rejectJournalAutomation(getActiveOrgId(session), "autoFill")'],
    ["src/app/api/journal-documents/[id]/route.ts", 'rejectJournalAutomation(doc.organizationId, "autoFill")'],
    ["src/app/api/journal-documents/[id]/cleaning/route.ts", '"autoFill")'],
    ["src/app/api/journal-documents/[id]/climate/route.ts", '"autoFill")'],
    ["src/app/api/journal-documents/[id]/cold-equipment/route.ts", '"autoFill")'],
    ["src/app/api/journal-documents/[id]/uv-runtime/route.ts", '"autoFill")'],
    ["src/app/api/journal-documents/[id]/staff/route.ts", 'automationOn(await getJournalControls(document.organizationId), "autoFill")'],
    ["src/app/api/journal-documents/[id]/copy-yesterday/route.ts", 'rejectJournalAutomation(organizationId, "copyYesterday")'],
    ["src/app/api/dashboard/close-day/route.ts", 'rejectJournalAutomation(organizationId, "closeDayAutofill")'],
    ["src/app/api/journal-documents/auto-create/route.ts", 'rejectJournalAutomation(organizationId, "autoCreate")'],
    ["src/app/api/organizations/auto-journals/preview/route.ts", 'rejectJournalAutomation(organizationId, ["autoCreate", "autoFill"])'],
    ["src/app/api/organizations/auto-journals/apply/route.ts", 'rejectJournalAutomation(organizationId, "autoFill")'],
    ["src/app/api/organizations/auto-journals/route.ts", 'automationOn(controls, "autoCreate")'],
    ["src/app/api/organizations/auto-journals/route.ts", 'automationOn(controls, "autoFill")'],
    ["src/app/api/cron/auto-create-journals/route.ts", '!automationOn(await getJournalControls(org.id), "autoCreate")'],
    ["src/app/api/cron/auto-fill-journals/route.ts", '!automationOn(await getJournalControls(document.organizationId), "autoFill")'],
    ["src/app/api/cron/journal-automation/route.ts", 'automationOn(controls, "autoCreate")'],
    ["src/app/api/cron/journal-automation/route.ts", 'automationOn(controls, "autoFill")'],
    ["src/app/(dashboard)/settings/auto-journals/page.tsx", 'automationOn(controls, "autoCreate")'],
    ["src/components/journals/staff-journal-toolbar.tsx", '!automationOn(controls, "autoFill")'],
    ["src/components/journals/cleaning-document-client.tsx", 'automationOn(journalControls, "autoFill")'],
    ["src/components/journals/climate-document-client.tsx", 'automationOn(journalControls, "autoFill")'],
    ["src/components/journals/cold-equipment-document-client.tsx", 'automationOn(journalControls, "autoFill")'],
    ["src/components/journals/uv-lamp-runtime-document-client.tsx", 'automationOn(journalControls, "autoFill")'],
    ["src/components/journals/journal-document-shell.tsx", 'useAutomationOn("autoFill")'],
    ["src/components/journals/cleaning-ventilation-checklist-document-client.tsx", 'useAutomationOn("autoFill")'],
    ["src/components/journals/journal-auto-create-toggle.tsx", 'automationOn(controls, "autoCreate")'],
    ["src/components/journals/journal-auto-create-toggle.tsx", 'automationOn(controls, "autoFill")'],
    ["src/components/journals/copy-yesterday-button.tsx", '!automationOn(controls, "copyYesterday")'],
    ["src/components/journals/document-actions-bar.tsx", 'automationOn(controls, "copyYesterday")'],
    ["src/components/dashboard/close-day-card.tsx", '!automationOn(controls, "closeDayAutofill")'],
    ["src/components/layout/command-palette.tsx", 'useAutomationOn("closeDayAutofill")'],
    ["src/lib/settings-cards.ts", 'requiresAutomation: "autoCreate"'],
  ];
  for (const [file, needle] of guards) assert.ok(read(file).includes(needle), `${file}: ${needle}`);
  // Nothing reads the old flag any more.
  for (const file of new Set(guards.map(([file]) => file))) assert.ok(!/\.specialMode\b/.test(read(file)), file);
});

test("setup decisions only accept known journals and explicit decisions", () => {
  assert.deepEqual(parseJournalControls({ brakerageSetup: { finished_product: "declined", perishable_rejection: "configured", other: "configured" } }).brakerageSetup, { finished_product: "declined", perishable_rejection: "configured" });
  assert.deepEqual(parseJournalControls({ brakerageSetup: { finished_product: true } }).brakerageSetup, {});
});

test("brakerage requires explicitly selected responsible slots", () => {
  assert.equal(allowsImplicitJournalResponsible("finished_product"), false);
  assert.equal(allowsImplicitJournalResponsible("perishable_rejection"), false);
  assert.equal(allowsImplicitJournalResponsible("hygiene"), true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { allowsImplicitJournalResponsible, parseJournalControls, sensorCameraEnabled } from "./journal-controls";

test("sensor camera defaults off for absent, malformed and old controls", () => {
  for (const raw of [null, undefined, "", "bad json", "[]", {}, { sensorCamera: { cold_equipment_control: "true" } }]) {
    const controls = parseJournalControls(raw);
    assert.equal(controls.specialMode, false);
    assert.equal(sensorCameraEnabled(controls, "cold_equipment_control"), false);
    assert.equal(sensorCameraEnabled(controls, "climate_control"), false);
  }
});
test("camera is an explicit journal choice and special mode suppresses it without erasing choices", () => {
  const controls = parseJournalControls({ sensorCamera: { cold_equipment_control: true, unknown: true } });
  assert.equal(sensorCameraEnabled(controls, "cold_equipment_control"), true);
  assert.equal(sensorCameraEnabled(controls, "climate_control"), false);
  assert.equal(sensorCameraEnabled(controls, "unknown"), false);
  const special = parseJournalControls({ ...controls, specialMode: true });
  assert.equal(sensorCameraEnabled(special, "cold_equipment_control"), false);
  assert.equal(special.sensorCamera.cold_equipment_control, true);
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

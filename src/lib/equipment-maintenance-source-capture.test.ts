import test from "node:test";
import assert from "node:assert/strict";
import { captureMaintenanceSource, maintenanceServerSourceIdentity } from "./equipment-maintenance-presentation";
import { normalizeEquipmentMaintenanceConfig } from "@/lib/equipment-maintenance-document";

test("single raw read and original normalizer evaluation precede later JSX prop evaluation", () => {
  const events: string[] = [];
  const raw = { rows: [{ equipmentName: "RAW/custom equipment" }] };
  const document = {
    get config() { events.push("raw-read"); return raw; },
  };
  const props = {
    before: (events.push("before-prop"), true),
    ...captureMaintenanceSource(document.config, source => {
      events.push("normalize");
      assert.equal(source, raw);
      return normalizeEquipmentMaintenanceConfig(source);
    }),
    after: (events.push("after-prop"), true),
  };
  assert.deepEqual(events, ["before-prop", "raw-read", "normalize", "after-prop"]);
  assert.equal(props.sourceConfig, raw);
  assert.equal(props.initialConfig.rows[0].equipmentName, "RAW/custom equipment");
  assert.equal(Object.hasOwn(props.initialConfig, "sourceConfig"), false);
});

test("captured normalized object and raw source are returned without extra inspection or copying", () => {
  const events: string[] = [];
  const source = { get value() { events.push("unexpected-getter"); return "x"; } };
  const config = { rows: [{ id: "factory-ID" }] };
  const result = captureMaintenanceSource(source, raw => { assert.equal(raw, source); events.push("normalize"); return config; });
  assert.equal(result.initialConfig, config);
  assert.equal(result.sourceConfig, source);
  assert.deepEqual(events, ["normalize"]);
  const error = new Error("native original exception");
  assert.throws(() => captureMaintenanceSource(source, () => { throw error; }), caught => caught === error);
});

test("null/invalid/partial raw source equality survives actual default normalization", () => {
  for (const raw of [null, [], false, "invalid", {}, { rows: [] }, { rows: [null, false] }, { rows: [{}] }, { rows: [{ equipmentName: "Legacy" }] }]) {
    const original = JSON.stringify(raw);
    const a = captureMaintenanceSource(raw, normalizeEquipmentMaintenanceConfig);
    const b = captureMaintenanceSource(structuredClone(raw), normalizeEquipmentMaintenanceConfig);
    assert.equal(maintenanceServerSourceIdentity(a.initialConfig, a.sourceConfig), maintenanceServerSourceIdentity(b.initialConfig, b.sourceConfig));
    if (a.initialConfig.rows.length) assert.notEqual(a.initialConfig.rows[0].id, b.initialConfig.rows[0].id);
    assert.equal(JSON.stringify(raw), original);
  }
});

test("equal legacy rows without IDs compare as equal while real plan/fact/row/default-role changes differ", () => {
  const raw = { rows: [{ equipmentName: "RAW/name", maintenanceType: "A", plan: { jan: "02" }, fact: { jan: "7" } }] };
  const a = captureMaintenanceSource(raw, normalizeEquipmentMaintenanceConfig);
  const b = captureMaintenanceSource(structuredClone(raw), normalizeEquipmentMaintenanceConfig);
  assert.notEqual(a.initialConfig.rows[0].id, b.initialConfig.rows[0].id);
  const identity = maintenanceServerSourceIdentity(a.initialConfig, a.sourceConfig);
  assert.equal(identity, maintenanceServerSourceIdentity(b.initialConfig, b.sourceConfig));
  for (const changed of [
    { ...raw, rows: [] },
    { ...raw, approveRole: "Управляющий" },
    { ...raw, rows: [{ ...raw.rows[0], plan: { jan: "03" } }] },
    { ...raw, rows: [{ ...raw.rows[0], fact: { jan: "8" } }] },
    { ...raw, rows: [{ ...raw.rows[0], equipmentName: "Changed name" }] },
  ]) {
    const next = captureMaintenanceSource(changed, normalizeEquipmentMaintenanceConfig);
    assert.notEqual(identity, maintenanceServerSourceIdentity(next.initialConfig, next.sourceConfig));
  }
});

test("raw source key order is irrelevant, array order remains significant, null differs from omission", () => {
  const first = { approveRole: "RAW", rows: [{ equipmentName: "A", workType: "B" }] };
  const equal = { rows: [{ workType: "B", equipmentName: "A" }], approveRole: "RAW" };
  assert.equal(maintenanceServerSourceIdentity({}, first), maintenanceServerSourceIdentity({}, equal));
  assert.notEqual(maintenanceServerSourceIdentity({}, { rows: ["A", "B"] }), maintenanceServerSourceIdentity({}, { rows: ["B", "A"] }));
  assert.notEqual(maintenanceServerSourceIdentity({}, null), maintenanceServerSourceIdentity({}));
});

test("omitted/undefined raw prop retains legacy normalized config comparison", () => {
  const raw = { rows: [{ equipmentName: "Legacy without ID" }] };
  const a = normalizeEquipmentMaintenanceConfig(raw), b = normalizeEquipmentMaintenanceConfig(raw);
  assert.notEqual(maintenanceServerSourceIdentity(a), maintenanceServerSourceIdentity(b));
  assert.equal(maintenanceServerSourceIdentity(a), maintenanceServerSourceIdentity(a, undefined));
  assert.equal(maintenanceServerSourceIdentity(a), maintenanceServerSourceIdentity(structuredClone(a)));
  assert.notEqual(maintenanceServerSourceIdentity(a), maintenanceServerSourceIdentity({ ...a, year: a.year + 1 }));
});

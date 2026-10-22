import assert from "node:assert/strict";
import { test } from "node:test";
import {
  presentMaintenanceValue,
  maintenanceSourceHas,
  maintenanceRoleUsesFactory,
  maintenanceText,
  createMaintenanceFailureRegistry,
} from "./equipment-maintenance-presentation";
import { normalizeEquipmentMaintenanceConfig } from "@/lib/equipment-maintenance-document";

test("explicit identical Russian titles remain original; missing provenance gets a translated fallback", () => {
  const original = "График профилактического обслуживания оборудования";
  assert.equal(presentMaintenanceValue(original, false, "Maintenance schedule"), original);
  assert.equal(presentMaintenanceValue(original, undefined, "Maintenance schedule"), original);
  assert.equal(presentMaintenanceValue(original, true, "Maintenance schedule"), "Maintenance schedule");
  assert.equal(presentMaintenanceValue("", undefined, "Maintenance schedule"), "Maintenance schedule");
});

test("own-property presence protects explicit empty and custom-identical values", () => {
  for (const value of ["Управляющий", "", null, undefined]) {
    assert.equal(maintenanceSourceHas({ approveRole: value }, "approveRole"), true);
  }
  assert.equal(maintenanceSourceHas({}, "approveRole"), false);
  assert.equal(maintenanceSourceHas(Object.create({ approveRole: "Управляющий" }), "approveRole"), false);
  assert.equal(maintenanceSourceHas(null, "approveRole"), false);
  assert.equal(maintenanceSourceHas([], "approveRole"), false);
});

test("role factory witness follows actual native trimmed defaults while generic presence stays unchanged", () => {
  for (const raw of [null, false, 0, [], {},
    { approveRole: null, responsibleRole: false }, { approveRole: "", responsibleRole: "" },
    { approveRole: " \t ", responsibleRole: "\n" }, { approveRole: 123, responsibleRole: {} }]) {
    const config = normalizeEquipmentMaintenanceConfig(raw);
    assert.equal(config.approveRole, "Управляющий");
    assert.equal(config.responsibleRole, "Шеф-повар");
    assert.equal(maintenanceRoleUsesFactory(raw, "approveRole"), true);
    assert.equal(maintenanceRoleUsesFactory(raw, "responsibleRole"), true);
  }
  for (const raw of [{ approveRole: "Управляющий", responsibleRole: "Шеф-повар" },
    { approveRole: " Custom ", responsibleRole: "Custom" }]) {
    const config = normalizeEquipmentMaintenanceConfig(raw);
    assert.equal(maintenanceRoleUsesFactory(raw, "approveRole"), false);
    assert.equal(maintenanceRoleUsesFactory(raw, "responsibleRole"), false);
    assert.equal(config.approveRole, raw.approveRole.trim());
    assert.equal(config.responsibleRole, raw.responsibleRole.trim());
  }
  assert.equal(maintenanceSourceHas({ approveRole: null }, "approveRole"), true);
  assert.equal(maintenanceSourceHas({ approveRole: "" }, "approveRole"), true);
});

test("role witness never calls getters or toJSON and does not alter native read/failure behavior", () => {
  const reads: string[] = [];
  const raw = Object.defineProperties({}, Object.fromEntries(["rows", "year", "documentDate", "approveRole", "approveEmployeeId", "approveEmployee", "responsibleRole", "responsibleEmployeeId", "responsibleEmployee"].map(key => [key, { get() { reads.push(key); return undefined; } }])));
  assert.equal(maintenanceRoleUsesFactory(raw, "approveRole"), false);
  assert.equal(maintenanceRoleUsesFactory(raw, "responsibleRole"), false);
  assert.deepEqual(reads, []);
  normalizeEquipmentMaintenanceConfig(raw);
  const original = [...reads]; reads.length = 0;
  maintenanceRoleUsesFactory(raw, "approveRole");
  maintenanceRoleUsesFactory(raw, "responsibleRole");
  normalizeEquipmentMaintenanceConfig(raw);
  assert.deepEqual(reads, original);
  const failure = new Error("native role failure");
  const throwing = Object.defineProperty({}, "approveRole", { get() { throw failure; } });
  assert.equal(maintenanceRoleUsesFactory(throwing, "approveRole"), false);
  assert.throws(() => normalizeEquipmentMaintenanceConfig(throwing), error => error === failure);
  assert.equal(maintenanceRoleUsesFactory(Object.create({ approveRole: "" }), "approveRole"), false);
  assert.equal(maintenanceRoleUsesFactory(new Date(), "approveRole"), false);
  let calls = 0;
  assert.equal(maintenanceRoleUsesFactory({ toJSON() { calls++; throw failure; } }, "approveRole"), true);
  assert.equal(calls, 0);
});

test("owned fallback errors retain original bytes while raw identical server errors remain raw", () => {
  const first = createMaintenanceFailureRegistry();
  const other = createMaintenanceFailureRegistry();
  const fallback = new Error("Не удалось сохранить журнал");
  const raw = new Error("Не удалось сохранить журнал");
  first.mark(fallback, "saveFailed");
  assert.equal(first.key(fallback), "saveFailed");
  assert.equal(fallback.message, "Не удалось сохранить журнал");
  assert.equal(first.key(raw), undefined);
  assert.equal(other.key(fallback), undefined);
  assert.equal(first.key("Не удалось сохранить журнал"), undefined);
});

test("ICU interpolation preserves the prior raw business-value conversion", () => {
  assert.equal(maintenanceText(2026), "2026");
  assert.equal(maintenanceText("01"), "01");
  assert.equal(maintenanceText("-"), "-");
  assert.equal(maintenanceText({ toString() { return "custom"; } }), "custom");
});

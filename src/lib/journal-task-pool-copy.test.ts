import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createTranslator } from "use-intl/core";
import type { Messages } from "@/i18n/messages";
import { omitPoolSublabel, poolDisplayCopy, poolEventCopy, presentPoolCopy } from "./journal-task-pool-copy";

for (const locale of ["ru", "en", "uz"] as const) {
  const directory = process.env.MINI_POOL_CATALOG_DIR ?? path.join(process.cwd(), "src/i18n/messages");
  const messages = JSON.parse(fs.readFileSync(path.join(directory, locale + ".json"), "utf8")) as Messages;
  const t = createTranslator({ locale, messages, namespace: "miniTaskPool" });
  test(`${locale}: strict opt-in and literal custom/prototype/invalid descriptor values`, () => {
    for (const enabled of [undefined, false, 1, "true", null]) assert.deepEqual(poolDisplayCopy(enabled, { key: "hygieneShift" }), {});
    const literal = "<CUSTOM> Гигиенический осмотр смены";
    for (const copy of [undefined, null, {}, { version: 2, scopeLabel: { key: "hygieneShift" } }, { version: 1, scopeLabel: { key: "__proto__" } }, { version: 1, scopeLabel: { key: "constructor" } }, { version: 1, scopeLabel: Object.create({ key: "hygieneShift" }) }, { version: 1, scopeLabel: { key: "hygieneShift", params: {} } }]) assert.equal(presentPoolCopy(t, copy, "hygiene", "scopeLabel", literal), literal);
    assert.equal(presentPoolCopy(t, poolDisplayCopy(true, { key: "hygieneShift" }).displayCopy, "health_check", "scopeLabel", literal), literal);
    assert.equal(presentPoolCopy(t, poolDisplayCopy(true, { key: "hygieneShift" }).displayCopy, "hygiene", "sublabel", literal), literal);
    for (const shift of ["constructor", "__proto__", null, 4, {}]) assert.equal(presentPoolCopy(t, { version: 1, scopeLabel: { key: "coldShift", params: { name: literal, shift } } }, "cold_equipment_control", "scopeLabel", literal), literal);
    for (const count of [-1, Infinity, NaN, 1.5, "2", {}, Number.MAX_SAFE_INTEGER + 1]) assert.equal(presentPoolCopy(t, { version: 1, sublabel: { key: "equipmentCount", params: { count } } }, "equipment_maintenance", "sublabel", literal), literal);
    for (const name of ["Утро", "<script>Oʻtkir</script>", ""]) assert.equal(presentPoolCopy(t, { version: 1, scopeLabel: { key: "coldShift", params: { name, shift: "morning" } } }, "cold_equipment_control", "scopeLabel", literal), t("coldShift", { name, shift: "morning" }));
    assert.equal(poolEventCopy("constructor"), undefined);
    const copy = poolDisplayCopy(true, { key: "hygieneShift" }, { key: "climateHint" }).displayCopy;
    const original = structuredClone(copy);
    assert.equal(omitPoolSublabel(copy)?.sublabel, undefined);
    assert.deepEqual(copy, original);
  });
}

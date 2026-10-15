import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { ReactElement } from "react";

test("generic journal layouts supply their client copy without leaking that namespace to other journals", async () => {
  const require = createRequire(import.meta.url), compiled = { exports: {} };
  const source = ts.transpileModule(readFileSync("src/app/(dashboard)/journals/[code]/layout.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { module: compiled, exports: compiled.exports, require: (id: string) => {
    if (id === "@/components/journals/journal-doc-guide") return { JournalDocGuideOverlay: () => null };
    if (id === "@/components/i18n/domain-messages-boundary") return { DomainMessagesBoundary: () => null };
    return require(id);
  } });
  const layout = (compiled.exports as { default: (input: { children: null; params: Promise<{ code: string }> }) => Promise<ReactElement<{ namespaces: string[] }>> }).default;
  const codes = ["daily_samples", "vitaminization", "ration_control", "transport_temperature", "tableware_breakage", "pool_water_control", "inventory_condition", "instrument_sterilization", "medical_waste_b", "batch_release"];
  for (const code of [...codes, "hygiene", "complaint_register", "constructor", "__proto__"]) {
    const { props } = await layout({ children: null, params: Promise.resolve({ code }) });
    assert.equal(props.namespaces.includes("genericRegister"), codes.includes(code), code);
    assert.ok(props.namespaces.includes("journalFields"));
    assert.equal(new Set(props.namespaces).size, props.namespaces.length);
  }
});

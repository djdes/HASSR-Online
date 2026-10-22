import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { formatDate, type Locale } from "@/i18n/locales";

// Exercise the private function's actual source without adding a production export.
const file = resolve(process.env.HYGIENE_CALENDAR_SOURCE_ROOT || process.cwd(), "src/components/journals/hygiene-document-client.tsx");
const source = readFileSync(file, "utf8");
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "formatHygieneMonthLabel");
assert.ok(declaration);
const compiled = ts.transpileModule(declaration.getText(ast) + "\nexports.monthLabel = formatHygieneMonthLabel;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const result: { monthLabel?: (from: string, to: string, locale: Locale) => string } = {};
vm.runInNewContext(compiled, { exports: result, formatDate, Date });
const monthLabel = result.monthLabel!;

test("actual hygiene heading function preserves partial period, prefix parsing and year boundaries", () => {
  assert.equal(monthLabel("2026-10-01", "2026-10-31", "uz"), "oktabr, 2026");
  assert.equal(monthLabel("2026-10-01T23:59:00-11:00", "2026-10-31", "uz"), "oktabr, 2026");
  assert.equal(monthLabel("2026-12-31", "2027-01-01", "uz"), "31/12/2026 — 01/01/2027");
  assert.equal(monthLabel("2024-02-29", "2024-02-29", "en"), "February 2024");
  assert.equal(monthLabel("invalid", "2026-10-31", "uz"), "");
  for (const locale of ["ru", "en", "uz"] as const) for (let month = 1; month <= 12; month++) {
    const day = `2026-${String(month).padStart(2, "0")}-01`;
    assert.equal(monthLabel(day, day, locale), formatDate(locale, new Date(`${day}T00:00:00Z`), "UTC", { month: "long", year: "numeric" }));
  }
});

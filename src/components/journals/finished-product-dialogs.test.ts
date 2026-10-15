/* eslint-disable react/no-children-prop -- SSR fixtures use createElement. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React, { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import { normalizeFinishedProductDocumentConfig } from "@/lib/finished-product-document";
import { JournalCustomCell } from "./journal-custom-cell";
import { FinishedProductGradeCell } from "./finished-product-grade-cell";
const require = createRequire(import.meta.url);
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const inline = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
// SSR cannot mount Radix portals. Keep production JSX and hooks, replacing only
// portal visibility. Optional initial-state fixtures exercise otherwise hidden steps.
function load<T>(name: string, states?: Record<number, unknown>): T {
  const file = `src/components/journals/${name}.tsx`;
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const fixture = { exports: {} };
  let index = 0;
  vm.runInNewContext(code, { module: fixture, exports: fixture.exports, require: (id: string) => {
    if (id === "react" && states) return { ...React, useState: (initial: unknown) => React.useState(Object.prototype.hasOwnProperty.call(states, index) ? states[index++] : (index++, initial)) };
    if (id === "@/components/ui/dialog") return { Dialog: inline, DialogContent: inline, DialogHeader: inline, DialogTitle: inline, DialogDescription: inline };
    if (id === "@/components/journals/v2/journal-settings-modal") return load("v2/journal-settings-modal");
    return id.startsWith("./") ? require("@/components/journals/" + id.slice(2)) : require(id);
  } });
  return fixture.exports as T;
}
async function render(locale: Locale, children: ReactNode) {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router, children: createElement(SearchParamsContext.Provider, { value: new URLSearchParams(), children: createElement(NextIntlClientProvider, { locale, messages: await loadMessages(locale), timeZone: "UTC", onError: error => { throw error; }, children }) }) }));
}

test("finished-product add/edit/settings and bulk dialog bodies render actual translated controls", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const m = (await loadMessages(locale)).finishedProduct;
    const { FinishedProductDocumentClient } = load<typeof import("./finished-product-document-client")>("finished-product-document-client");
    const html = await render(locale, createElement(FinishedProductDocumentClient, { documentId: "doc", title: "Customer title", organizationName: "Organization", dateFrom: "2026-10-01", dateTo: "2026-10-31", status: "active", initialConfig: normalizeFinishedProductDocumentConfig({}), users: [] }));
    for (const text of [m.fields.production, m.fields.organoleptic, m.settings.timeDefaults, m.settings.grades, m.settings.addGrade, m.actions.saveNext]) assert.ok(html.includes(text), locale + ": " + text);
    const { FinishedProductBulkDialog } = load<typeof import("./finished-product-bulk-dialog")>("finished-product-bulk-dialog");
    const bulk = await render(locale, createElement(FinishedProductBulkDialog, { open: true, onOpenChange() {}, table: "Original table", commonFields: "Original fields", onSubmit() {} }));
    assert.ok(bulk.includes(m.bulk.title) && bulk.includes(m.bulk.common) && bulk.includes("Original fields"));
    if (locale !== "ru") assert.doesNotMatch(html + bulk, /Какое время ставить|Варианты органолептической|Добавить изделия|Время изготовления — из меню|Закрыть/);
  }
});

test("pipeline all four steps, canonical choices, temperature warnings and summary render in RU/EN/UZ", async () => {
  const data = { productName: "Custom dish", batchNumber: "Original batch", sourceLabel: "User source", cookingMethod: "boiling", cookingTemperature: "60", processStartTime: "08:30", appearance: "excellent", taste: "good", smell: "satisfactory", consistency: "unsatisfactory", servingTemperature: "50", decision: "rework", approvedForRelease: false, deviationReason: "Original reason", notes: "Original note" };
  for (const locale of ["ru", "en", "uz"] as const) {
    const m = (await loadMessages(locale)).finishedProduct;
    for (const step of ["intro", "cooking", "tasting", "decision"] as const) {
      const { FinishedProductPipeline } = load<typeof import("./finished-product-pipeline")>("finished-product-pipeline", { 0: step, 1: data });
      const html = await render(locale, createElement(FinishedProductPipeline, {}));
      assert.ok(html.includes(m.pipeline.steps[step]), `${locale}: ${step}`);
      if (step === "cooking") assert.ok(html.includes(m.pipeline.methods.boiling) && html.includes('value="60"'));
      if (step === "tasting") assert.ok(html.includes(m.grades.excellent) && html.includes(m.grades.unsatisfactory));
      if (step === "decision") assert.ok(html.includes("Original reason") && html.includes("Custom dish") && html.includes(m.pipeline.decisions.rework));
      if (locale !== "ru") assert.doesNotMatch(html, /Сохранить и следующее|Что готовим|Наименование блюда|Обработка:|Варка|Отлично|Температура отпуска горячих/);
    }
  }
});

test("finished-product edit fields, generated menu hints and expanded guidance are translated without changing times", async () => {
  const config = normalizeFinishedProductDocumentConfig({ showProductTemp: true, rows: [{ id: "row-1", productName: "Original dish", productTemp: "74", portionWeight: "200/10", productionDateTime: "2026-10-15 10:00", rejectionTime: "2026-10-15 10:05", releasePermissionTime: "2026-10-15 10:10", organoleptic: "Отлично" }] });
  for (const locale of ["ru", "en", "uz"] as const) {
    for (const editing of [false, true]) {
      const { FinishedProductDocumentClient } = load<typeof import("./finished-product-document-client")>("finished-product-document-client", { 7: editing ? "row-1" : null, 16: config.rows[0], 17: true, 18: true, 19: true, 21: true });
      const html = await render(locale, createElement(FinishedProductDocumentClient, { documentId: "doc", title: "Customer title", organizationName: "Org", dateFrom: "2026-10-01", dateTo: "2026-10-31", status: "active", initialConfig: config, users: [] }));
      const m = (await loadMessages(locale)).finishedProduct;
      for (const expected of [m.quality.method, m.quality.A, m.quality.H, "+85", "&gt;+75", "Original dish", "200/10"]) assert.ok(html.includes(expected), locale + ": " + expected);
      if (editing) assert.ok(html.includes(m.fields.releaseDateTime));
      if (locale !== "ru") assert.doesNotMatch(html, /Исправьте, если сегодня иначе|Осмотр лучше проводить|Изменение записи|Сейчас \(разрешение/);
    }
  }
});

test("shared editors preserve stored option values while translating visible labels and accessibility text", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const bool = await render(locale, createElement(JournalCustomCell, { column: { key: "custom-1", label: "Custom label", type: "boolean" }, value: "Да", onChange() {} }));
    assert.ok(bool.includes(messages.journalControls.customCell.yes));
    const grade = await render(locale, createElement(FinishedProductGradeCell, { config: normalizeFinishedProductDocumentConfig({}), value: "Отлично", onChange() {}, onBlur() {} }));
    assert.ok(grade.includes('value="Отлично" selected=""'));
    assert.ok(grade.includes(messages.finishedProduct.grades.excellent));
    const { ApplyToSelectedDialog } = load<typeof import("./apply-to-selected-dialog")>("apply-to-selected-dialog");
    const selected = await render(locale, createElement(ApplyToSelectedDialog, { open: true, onOpenChange() {}, count: 2, fields: [{ key: "original-key", label: "Original label", type: "text" }], onApply() {} }));
    assert.ok(selected.includes("Original label") && selected.includes(messages.journalControls.applySelected.description));
    const { CommissionDialog } = load<typeof import("./commission-dialog")>("commission-dialog", { 2: true, 7: { fullName: "User Name", role: "Custom Role", phone: "", pin: "1234" } });
    const commission = await render(locale, createElement(CommissionDialog, { code: "finished_product", open: true, onClose() {} }));
    assert.ok(commission.includes(messages.journalControls.commissionDialog.description));
    if (locale !== "ru") assert.doesNotMatch(bool + selected + commission, /Сторонняя бракеражная|Применить ко всем выделенным|Загружаем/);
  }
});

test("directory, commission and dish-pool dialogs render loaded, empty, issued-PIN and confirmation states", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const m = (await loadMessages(locale)).journalControls;
    for (const items of [[], ["Original dish"]]) {
      const { OrgDirectoryDialog } = load<typeof import("./org-directory-dialog")>("org-directory-dialog", { 0: items });
      const html = await render(locale, createElement(OrgDirectoryDialog, { open: true, kind: "dish", existing: [], onClose() {}, onAdd() {} }));
      assert.ok(html.includes(items.length ? "Original dish" : m.orgDirectory.empty));
      assert.ok(html.includes(m.orgDirectory.sources.dish));
    }
    for (const unlink of [false, true]) {
      const { DishPoolSection } = load<typeof import("./dish-pool-section")>("dish-pool-section", { 0: { ownCode: "Keep-code", linkedCode: unlink ? "Linked-code" : null, linkedOrganizationName: unlink ? "Original organization" : null, poolSize: 3 }, 2: { code: "Other-code", organizationName: "Other organization", poolSize: 4 }, 3: unlink });
      const html = await render(locale, createElement(DishPoolSection, {}));
      for (const value of ["Keep-code", m.dishPool.description, ...(unlink ? ["Original organization"] : [])]) assert.ok(html.includes(value), locale + ": " + value);
      assert.doesNotMatch(html, /<input|Other organization/);
      assert.ok(!html.includes(m.dishPool.unlinkHint));
    }
    const { CommissionDialog } = load<typeof import("./commission-dialog")>("commission-dialog", { 0: [{ employeeId: "u1", name: "Original member", role: "Original role" }], 1: [{ id: "u2", name: "Candidate", group: "staff", position: "Custom position", hasPin: true }], 2: true, 5: true, 8: { name: "Original member", pin: "6543" } });
    const commission = await render(locale, createElement(CommissionDialog, { code: "finished_product", open: true, onClose() {} }));
    for (const value of ["Original member", "Original role", "6543", "Candidate", m.commissionDialog.groupStaff]) assert.ok(commission.includes(value), locale + ": " + value);
    if (locale !== "ru") assert.doesNotMatch(commission, /передайте сотруднику|Сотрудники|Состав не задан/);
  }
});

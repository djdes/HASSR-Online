/* eslint-disable react/no-children-prop -- SSR fixtures pass children through createElement. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import { getDefaultEquipmentCalibrationConfig } from "@/lib/equipment-calibration-document";
import { EquipmentDirectoryField } from "./equipment-directory-field";

const require = createRequire(import.meta.url);
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
// SSR has no portal host. Only the dialog visibility/portal adapter is replaced;
// production form JSX, hooks, controls, localization and field values are retained.
const inlineDialog = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
const dialogs = { Dialog: inlineDialog, DialogContent: inlineDialog, DialogHeader: inlineDialog, DialogTitle: inlineDialog, DialogDescription: inlineDialog };
function loadInlineDialogs<T>(file: string): T {
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const fixtureModule = { exports: {} };
  vm.runInNewContext(code, {
    module: fixtureModule, exports: fixtureModule.exports,
    require: (id: string) => id === "@/components/ui/dialog" ? dialogs : id === "@/components/journals/v2/journal-settings-modal" ? loadInlineDialogs("src/components/journals/v2/journal-settings-modal.tsx") : id.startsWith("./") ? require("@/components/journals/" + id.slice(2)) : require(id),
  });
  return fixtureModule.exports as T;
}

async function render(locale: Locale, children: ReactNode) {
  const messages = await loadMessages(locale);
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router, children: createElement(SearchParamsContext.Provider, { value: new URLSearchParams(), children: createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC", onError: error => { throw error; }, children }) }) }));
}

test("calibration add, edit and both settings dialog bodies translate their real form controls", async () => {
  const { EquipmentCalibrationDocumentClient } = loadInlineDialogs<typeof import("./equipment-calibration-document-client")>("src/components/journals/equipment-calibration-document-client.tsx");
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = (await loadMessages(locale)).equipmentCalibration;
    for (const useV2 of [false, true]) {
      const html = await render(locale, createElement(EquipmentCalibrationDocumentClient, { documentId: "doc-1", title: "Custom schedule", organizationName: "Custom organization", dateFrom: "2026-01-01", status: "active", initialConfig: getDefaultEquipmentCalibrationConfig(2026), users: [], useV2 }));
      for (const text of [messages.addRow, messages.instrumentName, messages.instrumentNumber, messages.intervalMonths, messages.settingsTitle, messages.documentDate, messages.choose, messages.save].filter(text => text !== messages.choose || useV2)) assert.ok(html.includes(text), locale + " expected " + text);
      assert.ok(html.includes(`placeholder="${messages.numberPlaceholder}"`));
      assert.ok(html.includes(`aria-label="${messages.close}"`));
      if (locale !== "ru") assert.doesNotMatch(html, /Сохранение|Выберите|Показать всех|Наименование|Отмена|Закрыть/);
    }
  }
});

test("shared equipment directory translates linked/unlinked states and preserves supplied labels and names", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = (await loadMessages(locale)).journalControls.equipmentDirectory;
    for (const linked of [false, true]) {
      for (const disabled of [false, true]) {
        const html = await render(locale, createElement(EquipmentDirectoryField, { label: "Custom field", value: "Original O‘tkir", sourceEquipmentId: linked ? "equipment-1" : null, directory: [{ id: "equipment-1", name: "Live O‘tkir" }], documentId: "doc-1", disabled, onChange() {} }));
        assert.ok(html.includes("Custom field"));
        assert.ok(html.includes(linked ? "Live O‘tkir" : "Original O‘tkir"));
        assert.ok(html.includes(linked ? messages.linkedHint : messages.customHint));
        if (linked && !disabled) assert.ok(html.includes(messages.unlink));
        if (!linked && !disabled) assert.ok(html.includes(messages.add));
        if (locale !== "ru") assert.doesNotMatch(html, /справочник|Показать всех|Отвязать|варианты/);
      }
    }
  }
});

test("shared settings modal translates loading and accessibility text while preserving explicit label overrides", async () => {
  const { JournalSettingsModal } = loadInlineDialogs<typeof import("./v2/journal-settings-modal")>("src/components/journals/v2/journal-settings-modal.tsx");
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = (await loadMessages(locale)).journalControls.settingsModal;
    const loading = await render(locale, createElement(JournalSettingsModal, { open: true, title: "Custom title", onOpenChange() {}, isSaving: true, onSave() {}, onCancel() {}, children: "Custom body" }));
    for (const text of ["Custom title", "Custom body", messages.saving, messages.cancel]) assert.ok(loading.includes(text));
    assert.ok(loading.includes(`aria-label="${messages.close}"`));
    const overrides = await render(locale, createElement(JournalSettingsModal, { open: true, title: "Custom title", saveLabel: "Custom save", cancelLabel: "Custom cancel", onOpenChange() {}, onSave() {}, onCancel() {}, children: "Body" }));
    assert.ok(overrides.includes("Custom save") && overrides.includes("Custom cancel"));
  }
});

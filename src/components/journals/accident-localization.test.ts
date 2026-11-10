/* eslint-disable react/no-children-prop -- Isolated production-component lifecycle fixtures. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { loadMessages } from "@/i18n/messages";
import { validateCatalog } from "@/i18n/catalog-validation";
import type { Locale } from "@/i18n/locales";
import { ACCIDENT_DOCUMENT_TITLE, createAccidentRow, normalizeAccidentDocumentConfig } from "@/lib/accident-document";
import { localDayKey } from "@/lib/entry-defaults";
import { AccidentDocumentClient } from "./accident-document-client";
import { AccidentDocumentsClient } from "./accident-documents-client";

const require = createRequire(import.meta.url);
type Node = { type: unknown; props: Record<string, unknown> };
const inline = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = (value: unknown): string => Array.isArray(value) ? value.map(text).join("") : typeof value === "string" ? value : "";
const row = createAccidentRow({ id: "original-row", accidentDate: "2026-10-15", accidentHour: "23", accidentMinute: "30", resolvedDate: "2026-10-16", resolvedHour: "01", resolvedMinute: "05", locationName: "Original O‘rik room", accidentDescription: "Original description", affectedProducts: "Original 20 кг", responsiblePeople: "Original people", correctiveActions: "Original actions" });
const props = { documentId: "original-document", title: ACCIDENT_DOCUMENT_TITLE, organizationName: "Original organization", dateFrom: "2026-10-01", status: "active", config: { rows: [row] } };

async function render(locale: Locale, child: React.ReactNode, navigate: (url: string) => void = () => {}) {
  return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: { back() {}, forward() {}, refresh() {}, push: navigate, replace() {}, prefetch() {} }, children: React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams(), children: React.createElement(NextIntlClientProvider, { locale, messages: await loadMessages(locale), timeZone: "UTC", onError: error => { throw error; }, children: child }) }) })).replaceAll("&#x27;", "'");
}

function fixture(fetcher: typeof fetch = async () => Response.json({ document: { id: "created-id" } })) {
  const states: unknown[] = [], refs: { current: unknown }[] = [], memos: { deps?: readonly unknown[]; value: unknown }[] = [], effectDeps: (readonly unknown[] | undefined)[] = [];
  const nodes: Node[] = [], effects: (() => void)[] = [], errors: string[] = [], successes: string[] = [], navigations: string[] = [], requests: { url: string; init?: RequestInit }[] = [];
  const exportChoices: ((locale: Locale) => void)[] = [], downloads: { href: string; target: string; rel: string }[] = [];
  let cursor = 0, refCursor = 0, memoCursor = 0, effectCursor = 0;
  const same = (a?: readonly unknown[], b?: readonly unknown[]) => a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const memo = (factory: () => unknown, deps?: readonly unknown[]) => { const index = memoCursor++; if (!memos[index] || !same(memos[index].deps, deps)) memos[index] = { deps, value: factory() }; return memos[index].value; };
  const hooks = { ...React,
    useState: (fallback: unknown) => { const index = cursor++; if (index >= states.length) states[index] = typeof fallback === "function" ? fallback() : fallback; return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
    useRef: (value: unknown) => { const index = refCursor++; return refs[index] ?? (refs[index] = { current: value }); },
    useMemo: memo, useCallback: (value: unknown, deps: readonly unknown[]) => memo(() => value, deps),
    useEffect: (effect: () => void, deps?: readonly unknown[]) => { const index = effectCursor++; if (!same(effectDeps[index], deps)) effects.push(effect); effectDeps[index] = deps; },
    useTransition: () => [false, (callback: () => void) => callback()],
  };
  const wrap = (fn: typeof jsxRuntime.jsx) => (type: unknown, props: Node["props"], key?: string) => { nodes.push({ type, props }); return fn(type as React.ElementType, props, key); };
  const cache = new Map<string, Record<string, unknown>>();
  function load(name: string): Record<string, unknown> {
    if (cache.has(name)) return cache.get(name)!;
    const filename = `src/components/journals/${name}.${["use-accident-copy", "use-auto-document-title", "use-sequential-edit", "use-journal-document-actions"].includes(name) ? "ts" : "tsx"}`;
    let code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    if (name === "accident-document-client") code += "\nexports.RowDialog=RowDialog; exports.SettingsDialog=SettingsDialog; exports.FinishDialog=FinishDialog;";
    if (name === "accident-documents-client") code += "\nexports.SettingsDialog=SettingsDialog; exports.DeleteDialog=DeleteDialog;";
    const fixtureModule = { exports: {} }; cache.set(name, fixtureModule.exports);
    const dependencies = new Set(["use-accident-copy", "use-auto-document-title", "use-sequential-edit", "use-document-dialog-submit", "use-journal-document-actions", "time-field"]);
    vm.runInNewContext(code, { module: fixtureModule, exports: fixtureModule.exports, Error, Date, document: { createElement() { return { href: "", target: "", rel: "", click() { downloads.push({ href: this.href, target: this.target, rel: this.rel }); } }; } }, fetch: async (url: string, init?: RequestInit) => { requests.push({ url, init }); return fetcher(url, init); }, require: (id: string) => {
      if (id === "react") return hooks;
      if (id === "react/jsx-runtime") return { ...jsxRuntime, jsx: wrap(jsxRuntime.jsx), jsxs: wrap(jsxRuntime.jsxs) };
      if (id === "@/components/ui/dialog") return { Dialog: inline, DialogContent: inline, DialogHeader: inline, DialogTitle: inline };
      if (id === "sonner") return { toast: { error: (value: string) => errors.push(value), success: (value: string) => successes.push(value) } };
      if (id === "@/components/ui/confirm-async") return { confirmAsync: async () => true };
      if (id === "./export-language-choice") return { useExportLanguageChoice: () => (callback: (locale: Locale) => void) => exportChoices.push(callback) };
      if (id === "@/components/journals/document-list-ui") return { ...require(id), useCanManageDocuments: () => true };
      if (id === "@/components/journals/v2/journal-settings-modal") return load("v2/journal-settings-modal");
      const basename = id.replace(/^.*\//, ""); if (dependencies.has(basename)) return load(basename);
      return id.startsWith("./") ? require("@/components/journals/" + id.slice(2)) : require(id);
    } });
    return fixtureModule.exports;
  }
  return { nodes, states, errors, successes, navigations, requests, exportChoices, downloads, load,
    find(predicate: (node: Node) => boolean) { const node = nodes.find(predicate); assert.ok(node, "Expected control"); return node.props; },
    button(label: string, last = false) { const matches = nodes.filter(node => typeof node.props.onClick === "function" && text(node.props.children) === label); const node = last ? matches.at(-1) : matches[0]; assert.ok(node, `Expected button ${label}`); return node.props.onClick as () => Promise<void>; },
    async render(locale: Locale, name: string, exportName: string, input: Record<string, unknown>) {
      cursor = 0; refCursor = 0; memoCursor = 0; effectCursor = 0; nodes.length = 0; effects.length = 0;
      const component = load(name)[exportName] as React.ComponentType<Record<string, unknown>>;
      const html = await render(locale, React.createElement(component, input), url => navigations.push(url));
      for (const effect of effects) effect();
      return html;
    },
  };
}

test("accident actual active/closed/empty list/detail renders all locales without changing user data", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const m = (await loadMessages(locale)).accidentJournal;
    assert.deepEqual(validateCatalog((await loadMessages("ru")).accidentJournal, m), []);
    for (const status of ["active", "closed"] as const) {
      for (const rows of [[row], []]) {
        const before = JSON.stringify(rows);
        const html = await render(locale, React.createElement(AccidentDocumentClient, { ...props, status, config: { rows } }));
        for (const expected of [m.title, m.columns.products, m.columns.actions]) assert.ok(html.includes(expected), locale + ": " + expected);
        if (rows.length) for (const expected of ["Original O‘rik room", "Original 20 кг", "23:30", "01:05"]) assert.ok(html.includes(expected));
        if (locale !== "ru") assert.doesNotMatch(html, /Журнал учета аварий|Закончить журнал|Небезопасная продукция|Начат/);
        assert.equal(JSON.stringify(rows), before);
      }
      const list = await render(locale, React.createElement(AccidentDocumentsClient, { activeTab: status, routeCode: "accident_journal", templateCode: "accident_journal", documents: [{ id: "original", title: "Customer title", status, dateFrom: "2026-10-01" }] }));
      assert.ok(list.includes(m.title) && list.includes("Customer title"));
    }
  }
});

test("accident real row form saves/reopens/edits unchanged clock fields and retains a draft across locale switches", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const m = (await loadMessages(locale)).accidentJournal;
    const view = fixture(); let saved: unknown = null;
    const input = { open: true, initialRow: row, onOpenChange() {}, onSave: async (value: unknown) => { saved = value; } };
    await view.render(locale, "accident-document-client", "RowDialog", input);
    const html = await view.render(locale, "accident-document-client", "RowDialog", input);
    for (const expected of [m.columns.description, m.columns.products, m.columns.people, m.columns.actions, (await loadMessages(locale)).journalControls.timeField.now]) assert.ok(html.includes(expected));
    const field = view.find(node => node.props.placeholder === m.row.descriptionPlaceholder);
    (field.onChange as (e: { target: { value: string } }) => void)({ target: { value: "Unsaved original text" } });
    const switched = await view.render(locale === "en" ? "uz" : "en", "accident-document-client", "RowDialog", input); assert.ok(switched.includes("Unsaved original text"));
    await view.render(locale, "accident-document-client", "RowDialog", input); await view.button(m.actions.save)();
    assert.deepEqual(JSON.parse(JSON.stringify(saved)), { ...row, accidentDescription: "Unsaved original text" });
    const reopen = fixture(); const reopenedInput = { ...input, initialRow: saved };
    await reopen.render(locale, "accident-document-client", "RowDialog", reopenedInput);
    assert.ok((await reopen.render(locale, "accident-document-client", "RowDialog", reopenedInput)).includes("Unsaved original text"));
  }
});

test("accident actual detail PATCH handlers preserve IDs, selected deletion and close stamp", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const view = fixture(); const m = (await loadMessages(locale)).accidentJournal;
    await view.render(locale, "accident-document-client", "AccidentDocumentClient", props);
    const rowDialog = view.find(node => typeof node.props.onSave === "function" && "initialRow" in node.props);
    await (rowDialog.onSave as (value: typeof row) => Promise<void>)({ ...row, id: "new-row", locationName: "New original room" });
    await view.render(locale, "accident-document-client", "AccidentDocumentClient", props);
    const payload = JSON.parse(String(view.requests[0].init?.body)); assert.equal(payload.config.rows.length, 2); assert.equal(payload.config.rows[1].id, "new-row"); assert.equal(payload.config.rows[1].accidentHour, "23"); assert.equal(view.requests[0].init?.method, "PATCH");
    const select = view.find(node => node.props["aria-label"] === m.actions.selectAll); (select.onCheckedChange as (value: boolean) => void)(true); await view.render(locale, "accident-document-client", "AccidentDocumentClient", props);
    const selection = view.find(node => node.props.hint === m.delete.hint); (selection.onDelete as () => void)(); await tick(); await tick();
    assert.equal(JSON.parse(String(view.requests.at(-1)?.init?.body)).config.rows.length, 0); assert.ok(view.successes[0].includes("2"));
    const close = fixture(); const input = { open: true, title: "Original title", documentId: "original-document", config: normalizeAccidentDocumentConfig({ rows: [row] }), onOpenChange() {}, onFinished() {} };
    await close.render(locale, "accident-document-client", "FinishDialog", input); await close.button(m.actions.finish)();
    const closed = JSON.parse(String(close.requests[0].init?.body)); assert.equal(closed.status, "closed"); assert.equal(closed.config.finishedAt, localDayKey()); assert.deepEqual(closed.config.rows[0], row);
  }
});

test("shared dialog keeps 409 title/force choices, custom fallback and current locale during deferred fetch/body", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const pendingStage of ["fetch", "body"] as const) {
    const deferredBody = Promise.withResolvers<unknown>(); const deferredResponse = Promise.withResolvers<Response>(); const view = fixture();
    const dialogApi = view.load("use-document-dialog-submit") as unknown as typeof import("./use-document-dialog-submit");
    let state: ReturnType<typeof dialogApi.useDocumentDialogSubmit>;
    const feedback: { customFallback?: string } = {};
    let closed = 0;
    const onOpenChange = (open: boolean) => { if (!open) closed++; };
    function Probe() { state = dialogApi.useDocumentDialogSubmit({ onOpenChange, fallbackError: feedback.customFallback }); return React.createElement(dialogApi.DocumentDialogFeedback, { state, routeCode: "accident_journal", onOpenChange, onForce: () => {} }); }
    view.load("use-document-dialog-submit").Probe = Probe;
    await view.render("en", "use-document-dialog-submit", "Probe", {});
    const bodyResponse = { ok: false, status: 500, json: async () => deferredBody.promise } as Response;
    const running = state!.run(async () => { await dialogApi.readCreatedDocument(pendingStage === "fetch" ? await deferredResponse.promise : bodyResponse); });
    await view.render(locale, "use-document-dialog-submit", "Probe", {}); deferredResponse.resolve(bodyResponse); deferredBody.resolve({ error: "RAW API FAILURE" }); await running;
    const html = await view.render(locale, "use-document-dialog-submit", "Probe", {});
    assert.ok(html.includes((await loadMessages(locale)).journalControls.documentDialog.createError)); assert.equal(closed, 0); assert.ok(!html.includes("RAW API"));
    await state!.run(async () => { await dialogApi.readCreatedDocument(Response.json({ existing: { id: "original-existing", title: "Original «O‘rik»" } }, { status: 409 })); });
    const duplicate = await view.render(locale, "use-document-dialog-submit", "Probe", {}); assert.ok(duplicate.includes("Original «O‘rik»")); assert.equal(state!.duplicate?.id, "original-existing");
    await view.button((await loadMessages(locale)).journalControls.documentDialog.openExisting)(); assert.equal(closed, 1); assert.ok(view.navigations.includes("/journals/accident_journal/documents/original-existing"));
    let forceSeen = false; await state!.run(async force => { forceSeen = force; }, true); assert.equal(forceSeen, true); assert.equal(closed, 2);
    feedback.customFallback = "Explicit custom feedback";
    await state!.run(async () => { throw new Error("Unknown untranslated prose"); });
    assert.ok((await view.render(locale, "use-document-dialog-submit", "Probe", {})).includes(feedback.customFallback));
  }
});

test("both accident settings presentations keep edits across locale changes and preserve submitted title/date", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const useV2 of [false, true]) {
    const view = fixture(); const submitted: unknown[] = [];
    const input = { open: true, title: "Customer title", dateFrom: "2026-10-01", useV2, onOpenChange() {}, onSave: async (value: unknown) => { submitted.push(value); } };
    await view.render(locale, "accident-document-client", "SettingsDialog", input);
    const html = await view.render(locale, "accident-document-client", "SettingsDialog", input); const m = (await loadMessages(locale)).accidentJournal;
    assert.ok(html.includes(m.settings.name) && html.includes(m.settings.start));
    const field = view.find(node => node.props.value === "Customer title" && typeof node.props.onChange === "function"); (field.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Unsaved O‘zgarmas title" } });
    assert.ok((await view.render("uz", "accident-document-client", "SettingsDialog", input)).includes("Unsaved O‘zgarmas title"));
    if (useV2) { const modal = view.find(node => typeof node.props.onSave === "function" && node.props.size === "md"); await (modal.onSave as () => Promise<void>)(); }
    else await view.button((await loadMessages("uz")).accidentJournal.actions.save)();
    assert.deepEqual(JSON.parse(JSON.stringify(submitted)), [{ title: "Unsaved O‘zgarmas title", dateFrom: "2026-10-01" }]);
  }
});

test("shared native TimeField translates chrome, preserves explicit label and normalized clock callbacks", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const view = fixture(); const changes: string[] = [], commits: string[] = [];
    const input = { value: "9:5", label: "Custom clock label", onChange: (value: string) => changes.push(value), onCommit: (value: string) => commits.push(value) };
    const html = await view.render(locale, "time-field", "TimeField", input);
    assert.ok(html.includes('value="09:05"') && html.includes("Custom clock label"));
    const control = view.find(node => node.props.type === "time"); assert.equal(control["aria-label"], "Custom clock label");
    (control.onChange as (e: { target: { value: string } }) => void)({ target: { value: "23:59" } }); (control.onBlur as (e: { target: { value: string } }) => void)({ target: { value: "23:59" } });
    assert.deepEqual(changes, ["23:59"]); assert.deepEqual(commits, ["23:59"]);
    const now = (await loadMessages(locale)).journalControls.timeField.now; await view.button(now)(); assert.match(changes.at(-1)!, /^\d{2}:\d{2}$/); assert.equal(changes.at(-1), commits.at(-1));
    await view.render(locale, "time-field", "TimeField", { ...input, disabled: true }); const length = changes.length; await view.button(now)(); assert.equal(changes.length, length);
    const defaultLabel = await view.render(locale, "time-field", "TimeField", { ...input, label: undefined }); assert.ok(defaultLabel.includes((await loadMessages(locale)).journalControls.timeField.time));
  }
});

test("accident actual list create and forced duplicate preserve custom title, annual period and navigation", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    let requestCount = 0;
    const view = fixture(async () => ++requestCount === 1 ? Response.json({ existing: { id: "existing-id", title: "Original existing title" } }, { status: 409 }) : Response.json({ document: { id: "created-original-id" } }));
    const input = { activeTab: "active", routeCode: "accident_journal", templateCode: "accident_journal", documents: [] };
    const m = (await loadMessages(locale)).accidentJournal;
    await view.render(locale, "accident-documents-client", "AccidentDocumentsClient", input);
    await view.button(m.actions.createDocument)(); await view.render(locale, "accident-documents-client", "AccidentDocumentsClient", input); await view.render(locale, "accident-documents-client", "AccidentDocumentsClient", input);
    const name = view.find(node => typeof node.props.value === "string" && (node.props.value as string).includes(m.title) && typeof node.props.onChange === "function");
    (name.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Customer O‘zgarmas title" } });
    const switched = await view.render(locale === "en" ? "uz" : "en", "accident-documents-client", "AccidentDocumentsClient", input); assert.ok(switched.includes("Customer O‘zgarmas title"));
    await view.render(locale, "accident-documents-client", "AccidentDocumentsClient", input); await view.button(m.actions.create)(); await tick();
    const duplicate = await view.render("uz", "accident-documents-client", "AccidentDocumentsClient", input); assert.ok(duplicate.includes("Original existing title"));
    const first = JSON.parse(String(view.requests[0].init?.body)); assert.equal(first.force, false); assert.equal(first.title, "Customer O‘zgarmas title"); assert.equal(first.templateCode, "accident_journal"); assert.ok(first.dateFrom.endsWith("-01-01") && first.dateTo.endsWith("-12-31"));
    await view.button((await loadMessages("uz")).journalControls.documentDialog.forceCreate)(); await tick();
    const second = JSON.parse(String(view.requests[1].init?.body)); assert.deepEqual(second, { ...first, force: true }); assert.equal(view.requests[1].init?.method, "POST");
    assert.ok(view.navigations.includes("/journals/accident_journal/documents/created-original-id"));
  }
});

test("accident list PDF action requests a language before downloading the exact document", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const view = fixture();
    await view.render(locale, "accident-documents-client", "AccidentDocumentsClient", { activeTab: "active", routeCode: "accident_journal", templateCode: "accident_journal", documents: [{ id: "original/id", title: "Custom title", status: "active", dateFrom: "2026-10-01" }] });
    const menu = view.find(node => Array.isArray(node.props.items) && node.props.items.some(item => item.key === "print"));
    const action = (menu.items as { key: string; onSelect: () => void }[]).find(item => item.key === "print")!;
    action.onSelect();
    assert.equal(view.exportChoices.length, 1); assert.equal(view.downloads.length, 0);
    view.exportChoices[0](locale);
    assert.deepEqual(view.downloads, [{ href: `/api/journal-documents/original%2Fid/pdf?locale=${locale}`, target: "_blank", rel: "noopener noreferrer" }]);
  }
});

test("accident row/settings/delete/close pending failures show current language and retain the open dialog", async () => {
  for (const kind of ["row", "settings", "delete", "finish"] as const) {
    const pending = Promise.withResolvers<Response>();
    const view = fixture(async () => pending.promise);
    let closes = 0;
    const onOpenChange = (open: boolean) => { if (!open) closes++; };
    const failingAction = async () => { const response = await pending.promise; if (!response.ok) throw new Error("RAW CUSTOM FAILURE"); };
    const name = kind === "delete" ? "accident-documents-client" : "accident-document-client";
    const component = { row: "RowDialog", settings: "SettingsDialog", delete: "DeleteDialog", finish: "FinishDialog" }[kind];
    const input = kind === "row" ? { open: true, initialRow: row, onOpenChange, onSave: failingAction } : kind === "settings" ? { open: true, title: "Customer title", dateFrom: "2026-10-01", onOpenChange, onSave: failingAction } : kind === "delete" ? { open: true, title: "Customer title", onOpenChange, onConfirm: failingAction } : { open: true, title: "Customer title", documentId: "original-document", config: { rows: [row] }, onOpenChange, onFinished() {} };
    await view.render("en", name, component, input); await view.render("en", name, component, input);
    const en = (await loadMessages("en")).accidentJournal;
    const action = view.button(kind === "delete" ? en.actions.delete : kind === "finish" ? en.actions.finish : en.actions.save)();
    await view.render("uz", name, component, input); pending.resolve(Response.json({ error: "RAW API FAILURE" }, { status: 500 })); await action;
    assert.equal(closes, 0);
    const expected = (await loadMessages("uz")).accidentJournal.errors[kind === "finish" ? "generic" : kind]; assert.deepEqual(view.errors, [expected]);
    const html = await view.render("uz", name, component, input); assert.ok(html.includes(kind === "row" ? "Original description" : "Customer title"));
  }
});

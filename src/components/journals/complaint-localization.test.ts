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
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { loadMessages } from "@/i18n/messages";
import { validateCatalog } from "@/i18n/catalog-validation";
import type { Locale } from "@/i18n/locales";
import { COMPLAINT_REGISTER_TITLE, COMPLAINT_RECEIPT_OPTIONS, buildComplaintRow } from "@/lib/complaint-document";
import { complaintReceipt, complaintFieldLabel, complaintFieldOptions, complaintDecision } from "./complaint-presentation";
import { ComplaintDocumentClient } from "./complaint-document-client";
import { ComplaintDocumentsClient } from "./complaint-documents-client";

const require = createRequire(import.meta.url);
type Node = { type: unknown; props: Record<string, unknown> };
const inline = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = (value: unknown): string => Array.isArray(value) ? value.map(text).join("") : typeof value === "string" ? value : "";
const row = buildComplaintRow({ id: "original-row", receiptDate: "2026-10-15", applicantName: "Customer O‘rik", complaintReceiptForm: "по почте", applicantDetails: "Customer address", complaintContent: "Original complaint", decisionDate: "2026-10-16", decisionSummary: "Original decision" });
const config = { rows: [row], defaultResponsibleUserId: "original-person", defaultResponsibleTitle: "Customer job", finishedAt: null };
const props = { documentId: "original-document", title: COMPLAINT_REGISTER_TITLE, organizationName: "Original organization", dateFrom: "2026-01-01", dateTo: "2026-12-31", status: "active", initialConfig: config, users: [] };

async function render(locale: Locale, child: React.ReactNode, navigate: (url: string) => void = () => {}) {
  return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: { back() {}, forward() {}, refresh() {}, push: navigate, replace() {}, prefetch() {} }, children: React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams(), children: React.createElement(NextIntlClientProvider, { locale, messages: await loadMessages(locale), timeZone: "UTC", onError: error => { throw error; }, children: child }) }) })).replaceAll("&#x27;", "'");
}

test("complaint list/detail active closed empty and expanded mobile cards render three locales with literal customer data", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const m = (await loadMessages(locale)).complaintRegister;
    assert.deepEqual(validateCatalog((await loadMessages("ru")).complaintRegister, m), []);
    for (const status of ["active", "closed"] as const) for (const rows of [[row], []]) {
      const before = JSON.stringify(rows);
      const html = await render(locale, React.createElement(ComplaintDocumentClient, { ...props, status, initialConfig: { ...config, rows } }));
      for (const expected of [m.title, m.fields.applicantName, m.columns.receiptForm]) assert.ok(html.includes(expected), `${locale}: ${expected}`);
      if (rows.length) for (const expected of [row.values.applicantName, row.values.complaintContent, m.receipt.post]) assert.ok(html.includes(expected), expected);
      assert.equal(JSON.stringify(rows), before);
      const list = await render(locale, React.createElement(ComplaintDocumentsClient, { activeTab: status, routeCode: "complaintjournal", documents: [{ id: "original", title: "Customer document", status, dateFrom: "2026-01-01", config }] }));
      assert.ok(list.includes(m.title) && list.includes("Customer document"));
    }
    const view = fixture(); await view.render(locale, "complaint-document-client", "ComplaintDocumentClient", props);
    const cards = view.nodes.find(node => typeof node.type === "function" && node.type.name === "RecordCardsView"); assert.ok(cards);
    const html = await render(locale, React.createElement(cards.type as React.ComponentType<Record<string, unknown>>, { ...cards.props, defaultExpandFirst: true }));
    for (const expected of [m.cards.receiptForm, m.receipt.post, row.values.applicantName, row.values.decisionSummary]) assert.ok(html.includes(expected), expected);
  }
});

test("actual complaint row dropdown saves all canonical options and unknown legacy value, reopens and retains locale drafts", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const value of [...COMPLAINT_RECEIPT_OPTIONS.map(option => option.value), "Customer custom method"]) {
    const view = fixture(); let saved = row;
    const input = { open: true, row: { ...row, values: { ...row.values, complaintReceiptForm: value } }, period: { dateFrom: props.dateFrom, dateTo: props.dateTo }, onOpenChange() {}, onSave: async (next: typeof row) => { saved = next; } };
    await view.render(locale, "complaint-document-client", "ComplaintRowDialog", input);
    await view.render(locale, "complaint-document-client", "ComplaintRowDialog", input);
    const select = view.find(node => typeof node.props.onValueChange === "function"); assert.equal(select.value, value);
    const option = view.find(node => node.props.value === value && node.props.onValueChange === undefined && node.props.children !== undefined);
    const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: "complaintRegister" }); assert.equal(text(option.children), complaintReceipt(value, t));
    (select.onValueChange as (value: string) => void)(value);
    const name = view.find(node => node.props.value === row.values.applicantName && typeof node.props.onChange === "function");
    (name.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Unsaved original" } });
    assert.ok((await view.render("uz", "complaint-document-client", "ComplaintRowDialog", input)).includes("Unsaved original"));
    await view.button((await loadMessages("uz")).complaintRegister.actions.save)();
    assert.deepEqual(JSON.parse(JSON.stringify(saved)), { ...input.row, values: { ...input.row.values, applicantName: "Unsaved original" } });
    const reopen = fixture(); await reopen.render(locale, "complaint-document-client", "ComplaintRowDialog", { ...input, row: saved });
    assert.ok((await reopen.render(locale, "complaint-document-client", "ComplaintRowDialog", { ...input, row: saved })).includes("Unsaved original"));
  }
});

test("actual out-of-period helper preserves confirm cancel and pure date predicates with full localized sentences", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const choice of [true, false]) {
    const view = fixture(); view.confirm(choice); const m = (await loadMessages(locale)).journalControls.dateInPeriod;
    let saved = 0; const input = { open: true, row, period: { dateFrom: "2027-01-01", dateTo: "2027-12-31" }, onOpenChange() {}, onSave: async () => { saved++; } };
    await view.render(locale, "complaint-document-client", "ComplaintRowDialog", input); await view.render(locale, "complaint-document-client", "ComplaintRowDialog", input);
    await view.button((await loadMessages(locale)).complaintRegister.actions.save)();
    assert.equal(saved, choice ? 1 : 0); assert.equal(view.confirmations[0].title, m.title); assert.equal(view.confirmations[0].locale, locale); assert.equal(view.confirmations[0].confirmLabel, m.saveAnyway);
    const helper = view.load("confirm-date-in-period").confirmDateInPeriod as (date: string, period: { dateFrom: string; dateTo: string }, presentation?: unknown) => Promise<boolean>;
    for (const date of ["", "invalid", "2027-06-01"]) assert.equal(await helper(date, input.period), true);
    assert.equal(await helper("2100-01-01", { dateFrom: "2027-01-01", dateTo: "2099-12-31" }), true);
    const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: "journalControls.dateInPeriod" });
    await helper("2026-01-01", { dateFrom: "2027-01-01", dateTo: "2099-12-31" }, { locale, t });
    assert.ok(String(view.confirmations.at(-1)?.description).includes(locale === "en" ? "starting" : locale === "uz" ? "boshlab" : "с "));
  }
});

test("actual complaint add sequential edit delete settings and close preserve canonical payload differences", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const view = fixture(), m = (await loadMessages(locale)).complaintRegister;
    await view.render(locale, "complaint-document-client", "ComplaintDocumentClient", props);
    await view.button(m.actions.add)(); await view.render(locale, "complaint-document-client", "ComplaintDocumentClient", props);
    let dialog = view.find(node => "row" in node.props && typeof node.props.onSave === "function");
    await (dialog.onSave as (value: typeof row) => Promise<void>)({ ...row, id: "added-row" });
    await view.render(locale, "complaint-document-client", "ComplaintDocumentClient", props);
    let payload = JSON.parse(String(view.requests.at(-1)?.init?.body)); assert.deepEqual(Object.keys(payload), ["title", "config"]); assert.equal(payload.title, COMPLAINT_REGISTER_TITLE); assert.equal(payload.config.defaultResponsibleUserId, "original-person");
    (view.find(node => node.props["aria-label"] === m.actions.selectAll).onCheckedChange as (checked: boolean) => void)(true);
    await view.render(locale, "complaint-document-client", "ComplaintDocumentClient", props);
    (view.find(node => typeof node.type === "function" && node.type.name === "SelectionEditButton").onClick as () => void)();
    for (const id of ["original-row", "added-row"]) {
      await view.render(locale, "complaint-document-client", "ComplaintDocumentClient", props); dialog = view.find(node => "row" in node.props && typeof node.props.onSave === "function");
      assert.equal((dialog.row as typeof row).id, id); await (dialog.onSave as (value: typeof row) => Promise<void>)({ ...dialog.row as typeof row, values: { ...(dialog.row as typeof row).values, decisionSummary: `Decision ${id}` } });
    }
    await view.render(locale, "complaint-document-client", "ComplaintDocumentClient", props);
    (view.find(node => node.props.hint === m.delete.hint).onDelete as () => void)(); await tick(); await tick();
    payload = JSON.parse(String(view.requests.at(-1)?.init?.body)); assert.equal(payload.config.rows.length, 0); assert.equal(payload.title, COMPLAINT_REGISTER_TITLE);
    const settings = view.find(node => typeof node.props.onSave === "function" && "dateFrom" in node.props);
    await (settings.onSave as (value: unknown) => Promise<void>)({ title: "Customer title", dateFrom: "2027-03-15" });
    payload = JSON.parse(String(view.requests.at(-1)?.init?.body)); assert.equal(payload.dateFrom, "2027-01-01"); assert.equal(payload.dateTo, "2027-12-31");
    await view.render(locale, "complaint-document-client", "ComplaintDocumentClient", props);
    await (view.find(node => typeof node.props.onFinish === "function").onFinish as () => Promise<void>)();
    payload = JSON.parse(String(view.requests.at(-1)?.init?.body)); assert.equal(payload.status, "closed"); assert.match(payload.config.finishedAt, /^\d{4}-\d{2}-\d{2}$/); assert.equal(payload.config.defaultResponsibleTitle, "Customer job"); assert.ok(view.navigations.includes("/journals/complaint_register?tab=closed"));
  }
});

test("actual create and list settings retain annual versus one-day periods, source titles, duplicates and locale feedback", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const view = fixture(); const input = { open: true, onOpenChange() {}, onCreated() {} };
    await view.render(locale, "complaint-documents-client", "CreateDialog", input); await view.render(locale, "complaint-documents-client", "CreateDialog", input);
    const field = view.find(node => node.props.id === "complaint-doc-title"); (field.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Custom original title" } });
    await view.render("uz", "complaint-documents-client", "CreateDialog", input); await view.button((await loadMessages("uz")).complaintRegister.actions.create)();
    const payload = JSON.parse(String(view.requests[0].init?.body)); assert.equal(payload.title, "Custom original title"); assert.ok(payload.dateFrom.endsWith("-01-01") && payload.dateTo.endsWith("-12-31")); assert.equal(payload.force, undefined);
    assert.ok(view.navigations.includes("/journals/complaint_register/documents/created-id"));
    const edit = fixture(), document = { id: "original-document", title: "Custom original title", dateFrom: "2026-03-15", status: "active", config };
    await edit.render(locale, "complaint-documents-client", "SettingsDialog", { open: true, document, onOpenChange() {}, onSaved() {} });
    await edit.render(locale, "complaint-documents-client", "SettingsDialog", { open: true, document, onOpenChange() {}, onSaved() {} });
    await edit.button((await loadMessages(locale)).complaintRegister.actions.save)(); assert.deepEqual(JSON.parse(String(edit.requests[0].init?.body)), { title: document.title, dateFrom: document.dateFrom, dateTo: document.dateFrom });
  }
  for (const stage of ["fetch", "body"] as const) {
    const pending = Promise.withResolvers<Response>(), body = Promise.withResolvers<unknown>();
    const response = { ok: false, status: 409, json: () => body.promise } as Response;
    const view = fixture(async () => stage === "fetch" ? pending.promise : response), input = { open: true, onOpenChange() {}, onCreated() {} };
    await view.render("en", "complaint-documents-client", "CreateDialog", input); const action = view.button((await loadMessages("en")).complaintRegister.actions.create)();
    await view.render("uz", "complaint-documents-client", "CreateDialog", input); pending.resolve(response); body.resolve({ error: "RAW API", existing: { id: "existing", title: "Original existing title" } }); await action;
    const t = createTranslator({ locale: "uz", messages: await loadMessages("uz"), namespace: "complaintRegister" }); assert.deepEqual(view.errors, [t("errors.duplicate", { title: "Original existing title" })]);
  }
});

test("both actual settings variants preserve drafts and deferred row errors use current locale without server prose", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const useV2 of [false, true]) {
    const view = fixture(); let saved: unknown;
    const input = { open: true, title: "Customer title", dateFrom: "2026-03-15", useV2, onOpenChange() {}, onSave: async (value: unknown) => { saved = value; } };
    await view.render(locale, "complaint-document-client", "SettingsDialog", input);
    const field = view.find(node => node.props.value === input.title && typeof node.props.onChange === "function"); (field.onChange as (e: { target: { value: string } }) => void)({ target: { value: "Unsaved original" } });
    assert.ok((await view.render("uz", "complaint-document-client", "SettingsDialog", input)).includes("Unsaved original"));
    if (useV2) await (view.find(node => node.props.size === "md" && typeof node.props.onSave === "function").onSave as () => Promise<void>)(); else await view.button((await loadMessages("uz")).complaintRegister.actions.save)();
    assert.deepEqual(JSON.parse(JSON.stringify(saved)), { title: "Unsaved original", dateFrom: "2026-03-15" });
  }
  const pending = Promise.withResolvers<void>(), view = fixture(); const input = { open: true, row, period: { dateFrom: props.dateFrom, dateTo: props.dateTo }, onOpenChange() {}, onSave: () => pending.promise };
  await view.render("en", "complaint-document-client", "ComplaintRowDialog", input); await view.render("en", "complaint-document-client", "ComplaintRowDialog", input); const action = view.button((await loadMessages("en")).complaintRegister.actions.save)();
  await view.render("uz", "complaint-document-client", "ComplaintRowDialog", input); pending.reject(new Error("RAW ERROR")); await action;
  assert.deepEqual(view.errors, [(await loadMessages("uz")).complaintRegister.errors.row]);
});

test("list direct PDF action opens language choice and retains original document identifier", async () => {
  const view = fixture(); const input = { activeTab: "active", routeCode: "complaintjournal", documents: [{ id: "original id", title: "Original title", dateFrom: "2026-01-01", status: "active", config }] };
  await view.render("en", "complaint-documents-client", "ComplaintDocumentsClient", input);
  const menu = view.find(node => Array.isArray(node.props.items) && (node.props.items as { key: string }[]).some(item => item.key === "print"));
  (menu.items as { key: string; onSelect(): void }[]).find(item => item.key === "print")!.onSelect(); assert.equal(view.exportChoices.length, 1);
  view.exportChoices[0]("uz"); assert.equal(view.downloads[0].href, "/api/journal-documents/original%20id/pdf?locale=uz");
});

test("complaint presentation matches exact built-in metadata and never translates arbitrary field contents", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: "complaintRegister" });
    const field = { key: "complaintReceiptForm", label: "Форма поступления жалобы", type: "select", required: true, options: [...COMPLAINT_RECEIPT_OPTIONS], showIf: { field: "complaintReceiptForm", equals: "по почте" } };
    const before = JSON.stringify(field), presented = complaintFieldOptions(field, t);
    assert.equal(complaintFieldLabel(field, t), t("fields.complaintReceiptForm"));
    assert.equal(complaintFieldLabel({ ...field, label: "Customer receipt label" }, t), "Customer receipt label");
    assert.equal(complaintFieldLabel({ ...field, key: "customField" }, t), field.label);
    assert.equal(complaintFieldOptions({ ...field, key: "customField" }, t).options[0].label, "по почте");
    assert.equal(complaintFieldOptions({ ...field, options: [{ value: "по почте", label: "Customer option" }] }, t).options[0].label, "Customer option");
    assert.deepEqual(presented.options.map(option => option.value), field.options.map(option => option.value)); assert.deepEqual(presented.showIf, field.showIf); assert.equal(JSON.stringify(field), before);
    assert.equal(complaintReceipt("ПО ПОЧТЕ", t), "ПО ПОЧТЕ");
    assert.equal(complaintDecision({ ...row, values: { ...row.values, decisionDate: "", decisionSummary: "по почте" } }, locale, t), "по почте");
  }
});

test("actual list delete and settings keep IDs and use current feedback after fetch/body; finish dialog retains callback semantics", async () => {
  for (const operation of ["delete", "settings"] as const) for (const stage of ["fetch", "body"] as const) for (const succeeds of [true, false]) {
    const pending = Promise.withResolvers<Response>(), body = Promise.withResolvers<unknown>();
    const response = { ok: succeeds, status: succeeds ? 200 : 403, json: () => body.promise } as Response;
    const view = fixture(async () => stage === "fetch" ? pending.promise : response); let closed = 0, callbacks = 0;
    const input = { open: true, document: { id: "original-id", title: "Customer original", dateFrom: "2026-04-15", status: "active", config }, onOpenChange: () => { closed++; }, onSaved: () => { callbacks++; }, onDeleted: () => { callbacks++; } };
    const component = operation === "delete" ? "DeleteDialog" : "SettingsDialog";
    await view.render("en", "complaint-documents-client", component, input); await view.render("en", "complaint-documents-client", component, input);
    const action = view.button((await loadMessages("en")).complaintRegister.actions[operation === "delete" ? "delete" : "save"])();
    await view.render("uz", "complaint-documents-client", component, input); pending.resolve(response); body.resolve({ error: "RAW API RESPONSE" }); await action;
    assert.equal(view.requests[0].url, "/api/journal-documents/original-id"); assert.equal(view.requests[0].init?.method, operation === "delete" ? "DELETE" : "PATCH");
    if (operation === "delete" && stage === "body") { assert.equal(callbacks, succeeds ? 1 : 0); continue; } // DELETE has never parsed a response body.
    assert.equal(callbacks, succeeds ? 1 : 0); assert.equal(closed, succeeds ? 1 : 0);
    assert.deepEqual(view.errors, succeeds ? [] : [(await loadMessages("uz")).complaintRegister.errors[operation === "delete" ? "deleteDocument" : "saveDocument"]]);
  }
  const pending = Promise.withResolvers<void>(), view = fixture(); let closed = 0;
  const input = { open: true, title: "Customer original", onOpenChange: () => { closed++; }, onFinish: () => pending.promise };
  await view.render("en", "complaint-document-client", "FinishDialog", input); const action = view.button((await loadMessages("en")).complaintRegister.actions.finishShort)();
  await view.render("uz", "complaint-document-client", "FinishDialog", input); pending.reject(new Error("RAW FINISH")); await action;
  assert.equal(closed, 0); assert.deepEqual(view.errors, [(await loadMessages("uz")).complaintRegister.errors.finish]);
});

function fixture(fetcher: typeof fetch = async () => Response.json({ document: { id: "created-id" } })) {
  const states: unknown[] = [], refs: { current: unknown }[] = [], memos: { deps?: readonly unknown[]; value: unknown }[] = [], effectDeps: (readonly unknown[] | undefined)[] = [];
  const nodes: Node[] = [], effects: (() => void)[] = [], errors: string[] = [], successes: string[] = [], navigations: string[] = [], requests: { url: string; init?: RequestInit }[] = [];
  const confirmations: Record<string, unknown>[] = []; let confirmed = true;
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
  const wrap = (fn: typeof jsxRuntime.jsx) => (type: unknown, props: Node["props"], key?: string) => {
    nodes.push({ type, props });
    // Parent-handler checks capture keyed row-dialog props; standalone row tests
    // execute its real body. A flat hook store does not model keyed remounts.
    if (typeof type === "function" && ["ComplaintRowDialog", "SettingsDialog", "FinishDialog", "CreateDialog", "DeleteDialog"].includes(type.name)) return fn(inline, {}, key);
    return fn(type as React.ElementType, props, key);
  };
  const cache = new Map<string, Record<string, unknown>>();
  function load(name: string): Record<string, unknown> {
    if (cache.has(name)) return cache.get(name)!;
    const filename = `src/components/journals/${name}.${["use-complaint-copy", "use-auto-document-title", "use-sequential-edit", "use-journal-document-actions", "confirm-date-in-period"].includes(name) ? "ts" : "tsx"}`;
    let code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    if (name === "complaint-document-client") code += "\nexports.ComplaintRowDialog=ComplaintRowDialog; exports.SettingsDialog=SettingsDialog; exports.FinishDialog=FinishDialog;";
    if (name === "complaint-documents-client") code += "\nexports.CreateDialog=CreateDialog; exports.SettingsDialog=SettingsDialog; exports.DeleteDialog=DeleteDialog;";
    const fixtureModule = { exports: {} }; cache.set(name, fixtureModule.exports);
    const dependencies = new Set(["use-complaint-copy", "use-auto-document-title", "use-sequential-edit", "use-document-dialog-submit", "use-journal-document-actions", "confirm-date-in-period"]);
    vm.runInNewContext(code, { module: fixtureModule, exports: fixtureModule.exports, Error, Date, document: { createElement() { return { href: "", target: "", rel: "", click() { downloads.push({ href: this.href, target: this.target, rel: this.rel }); } }; } }, fetch: async (url: string, init?: RequestInit) => { requests.push({ url, init }); return fetcher(url, init); }, require: (id: string) => {
      if (id === "react") return hooks;
      if (id === "react/jsx-runtime") return { ...jsxRuntime, jsx: wrap(jsxRuntime.jsx), jsxs: wrap(jsxRuntime.jsxs) };
      if (id === "@/components/ui/dialog") return { Dialog: inline, DialogClose: inline, DialogContent: inline, DialogHeader: inline, DialogTitle: inline };
      if (id === "@/components/ui/select") return { Select: inline, SelectContent: inline, SelectItem: inline, SelectTrigger: inline, SelectValue: inline };
      if (id === "sonner") return { toast: { error: (value: string) => errors.push(value), success: (value: string) => successes.push(value) } };
      if (id === "@/components/ui/confirm-async") return { confirmAsync: async (options: Record<string, unknown>) => { confirmations.push(options); return confirmed; } };
      if (id === "./export-language-choice") return { useExportLanguageChoice: () => (callback: (locale: Locale) => void) => exportChoices.push(callback) };
      if (id === "@/components/journals/document-list-ui") return { ...require(id), useCanManageDocuments: () => true };
      if (id === "@/components/journals/v2/journal-settings-modal") return load("v2/journal-settings-modal");
      const basename = id.replace(/^.*\//, ""); if (dependencies.has(basename)) return load(basename);
      return id.startsWith("./") ? require("@/components/journals/" + id.slice(2)) : require(id);
    } });
    return fixtureModule.exports;
  }
  return { confirmations, confirm(value: boolean) { confirmed = value; }, nodes, states, errors, successes, navigations, requests, exportChoices, downloads, load,
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

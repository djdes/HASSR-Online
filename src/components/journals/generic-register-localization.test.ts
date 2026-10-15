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
import type { Locale } from "@/i18n/locales";
import { REGISTER_JOURNALS, type RegisterJournalDefinition } from "@/lib/register-journals";
import { createRegisterDocumentRow, parseRegisterFields, type RegisterDocumentRow } from "@/lib/register-document";
import { resolveJournalPeriodForDate } from "@/lib/journal-period";
import { buildDocumentAutoTitle } from "@/lib/journal-document-title";
import { presentRegisterField, registerCell, registerDate, registerName, registerTitle } from "./generic-register-presentation";
import { RegisterDocumentClient } from "./register-document-client";
import { RegisterDocumentsClient } from "./register-documents-client";

const require = createRequire(import.meta.url);
type Node = { type: unknown; props: Record<string, unknown> };
const inline = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = (value: unknown): string => Array.isArray(value) ? value.map(text).join("") : typeof value === "string" ? value : "";
function sample(journal: RegisterJournalDefinition) {
  const values = Object.fromEntries(journal.fields.map(field => [field.key, field.type === "date" ? "2026-10-15" : field.type === "time" ? "12:30" : field.type === "number" ? "12.5" : field.type === "select" ? field.options![0].value : "Customer O‘rik original"]));
  const row = createRegisterDocumentRow(parseRegisterFields(journal.fields), { id: "original-row", values });
  const config = { rows: [row], defaultResponsibleUserId: "original-person", defaultResponsibleTitle: "Customer job", finishedAt: null };
  const period = resolveJournalPeriodForDate(journal.code, "2026-10-15");
  const props = { documentId: "original-document", templateCode: journal.code, title: journal.name, organizationName: "Original organization", ...period, status: "active", initialConfig: config, users: [{ id: "person", name: "Original name", role: "cook" }] };
  return { row, config, props, period };
}
async function render(locale: Locale, child: React.ReactNode, navigate: (url: string) => void = () => {}) {
  return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: { back() {}, forward() {}, refresh() {}, push: navigate, replace() {}, prefetch() {} }, children: React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams(), children: React.createElement(NextIntlClientProvider, { locale, messages: await loadMessages(locale), timeZone: "UTC", onError: error => { throw error; }, children: child }) }) })).replaceAll("&#x27;", "'");
}

test("all ten register families render actual active/closed empty/populated list/detail/cards in three locales", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const journal of REGISTER_JOURNALS) {
    const messages = await loadMessages(locale), m = messages.genericRegister, { row, config, props } = sample(journal);
    for (const status of ["active", "closed"] as const) for (const rows of [[row], []]) {
      const before = JSON.stringify(rows);
      const html = await render(locale, React.createElement(RegisterDocumentClient, { ...props, status, initialConfig: { ...config, rows } }));
      assert.ok(html.includes(messages.journals.names[journal.code as keyof typeof messages.journals.names]), `${locale}/${journal.code}: title`);
      assert.ok(html.includes(m.journals[journal.code as keyof typeof m.journals].hint));
      for (const field of journal.fields) assert.ok(html.includes(presentRegisterField(journal.code, field, messages).displayLabel), `${locale}/${journal.code}/${field.key}`);
      if (rows.length) assert.ok(html.includes("Customer O‘rik original"));
      assert.equal(JSON.stringify(rows), before);
      const list = await render(locale, React.createElement(RegisterDocumentsClient, { activeTab: status, routeCode: journal.code, templateCode: journal.code, templateName: journal.name, users: props.users, documents: rows.length ? [{ id: "original", title: "Customer document", status, dateFrom: props.dateFrom, dateTo: props.dateTo, rowsCount: rows.length }] : [] }));
      assert.ok(rows.length ? list.includes("Customer document") : list.includes(status === "closed" ? m.list.closedEmpty : m.journals[journal.code as keyof typeof m.journals].emptyDescription));
    }
    const view = fixture(); await view.render(locale, "register-document-client", "RegisterDocumentClient", props);
    const cards = view.nodes.find(node => typeof node.type === "function" && node.type.name === "RecordCardsView"); assert.ok(cards);
    const html = await render(locale, React.createElement(cards.type as React.ComponentType<Record<string, unknown>>, { ...cards.props, defaultExpandFirst: true }));
    for (const field of journal.fields.filter(field => field.type === "select")) assert.ok(html.includes(registerCell(journal.code, field, row.values[field.key], locale, messages)));
  }
});

test("actual row forms save/reopen every original option and unknown legacy option across locales without losing drafts", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const journal of REGISTER_JOURNALS) {
    const { row, period, props } = sample(journal), messages = await loadMessages(locale);
    const cases = journal.fields.filter(field => field.type === "select").flatMap(field => [...field.options!, { value: "Customer unknown value", label: "Customer unknown value" }].map(option => ({ field, option })));
    if (!cases.length) cases.push({ field: journal.fields.find(field => field.key === journal.titleKey)!, option: { value: "Original text", label: "Original text" } });
    for (const { field, option } of cases) {
      const view = fixture(); let saved: RegisterDocumentRow | undefined;
      const input = { open: true, row: { ...row, values: { ...row.values, [field.key]: option.value } }, fields: journal.fields, templateCode: journal.code, hint: messages.genericRegister.journals[journal.code as keyof typeof messages.genericRegister.journals].hint, period, users: props.users, onOpenChange() {}, onSave: async (value: RegisterDocumentRow) => { saved = value; } };
      await view.render(locale, "register-document-client", "RowDialog", input); await view.render(locale, "register-document-client", "RowDialog", input);
      if (field.type === "select") {
        const select = view.find(node => node.props.value === option.value && typeof node.props.onValueChange === "function");
        const actual = view.find(node => node.props.value === option.value && node.props.onValueChange === undefined && node.props.children !== undefined);
        assert.equal(text(actual.children), registerCell(journal.code, field, option.value, locale, messages));
        (select.onValueChange as (value: string) => void)(option.value);
      }
      const name = view.find(node => node.props.id === `register-field-${journal.titleKey}`);
      (name.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Unsaved original" } });
      assert.ok((await view.render("uz", "register-document-client", "RowDialog", input)).includes("Unsaved original"));
      await view.button((await loadMessages("uz")).genericRegister.actions.save)();
      assert.ok(saved); assert.equal(saved.id, row.id); assert.equal(saved.values[journal.titleKey], "Unsaved original");
      if (field.type === "select") assert.equal(saved.values[field.key], option.value);
      const reopen = fixture(); await reopen.render(locale, "register-document-client", "RowDialog", { ...input, row: saved });
      assert.ok((await reopen.render(locale, "register-document-client", "RowDialog", { ...input, row: saved })).includes("Unsaved original"));
    }
  }
});

test("actual add/sequence/delete/settings/close preserve each family's canonical payload and periods", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const journal of REGISTER_JOURNALS) {
    const { row, props } = sample(journal), view = fixture(), m = (await loadMessages(locale)).genericRegister;
    await view.render(locale, "register-document-client", "RegisterDocumentClient", props);
    await view.button(m.actions.add)(); await view.render(locale, "register-document-client", "RegisterDocumentClient", props);
    let dialog = view.find(node => "row" in node.props && typeof node.props.onSave === "function");
    await (dialog.onSave as (value: RegisterDocumentRow) => Promise<void>)({ ...row, id: "added-row" });
    let payload = JSON.parse(String(view.requests.at(-1)?.init?.body)); assert.deepEqual(Object.keys(payload), ["title", "config"]); assert.equal(payload.title, journal.name); assert.equal(payload.config.defaultResponsibleUserId, "original-person");
    await view.render(locale, "register-document-client", "RegisterDocumentClient", props);
    (view.find(node => node.props["aria-label"] === m.row.selectAll).onCheckedChange as (checked: boolean) => void)(true);
    await view.render(locale, "register-document-client", "RegisterDocumentClient", props);
    (view.find(node => typeof node.type === "function" && node.type.name === "SelectionEditButton").onClick as () => void)();
    for (const id of ["original-row", "added-row"]) {
      await view.render(locale, "register-document-client", "RegisterDocumentClient", props); dialog = view.find(node => "row" in node.props && typeof node.props.onSave === "function");
      assert.equal((dialog.row as RegisterDocumentRow).id, id); await (dialog.onSave as (value: RegisterDocumentRow) => Promise<void>)({ ...dialog.row as RegisterDocumentRow, values: { ...(dialog.row as RegisterDocumentRow).values, [journal.titleKey]: `Original ${id}` } });
    }
    await view.render(locale, "register-document-client", "RegisterDocumentClient", props);
    (view.find(node => node.props.hint === m.selection.hint).onDelete as () => void)(); await tick(); await tick();
    payload = JSON.parse(String(view.requests.at(-1)?.init?.body)); assert.equal(payload.config.rows.length, 0);
    (view.find(node => typeof node.props.onSettings === "function").onSettings as () => void)();
    await view.render(locale, "register-document-client", "RegisterDocumentClient", props);
    (view.find(node => node.props.id === "register-settings-title").onChange as (e: { target: { value: string } }) => void)({ target: { value: "Customer new title" } });
    (view.find(node => node.props.id === "register-settings-date").onChange as (e: { target: { value: string } }) => void)({ target: { value: "2027-03-15" } });
    await view.render("uz", "register-document-client", "RegisterDocumentClient", props);
    await view.button((await loadMessages("uz")).genericRegister.actions.save, true)();
    payload = JSON.parse(String(view.requests.at(-1)?.init?.body)); assert.equal(payload.title, "Customer new title");
    const expected = resolveJournalPeriodForDate(journal.code, "2027-03-15"); assert.equal(payload.dateFrom, expected.dateFrom); assert.equal(payload.dateTo, expected.dateTo);
    await view.render(locale, "register-document-client", "RegisterDocumentClient", props);
    const menu = view.find(node => Array.isArray(node.props.menuItems)).menuItems as { onSelect: () => void }[];
    menu[0].onSelect(); await tick(); await tick();
    payload = JSON.parse(String(view.requests.at(-1)?.init?.body)); assert.equal(payload.status, "closed"); assert.match(payload.config.finishedAt, /^\d{4}-\d{2}-\d{2}$/); assert.equal(payload.config.defaultResponsibleTitle, "Customer job"); assert.ok(view.navigations.includes(`/journals/${journal.code}?tab=closed`));
  }
});

test("required/date validation and both settings variants retain drafts with complete translated copy", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const journal of REGISTER_JOURNALS) {
    const { row, props, period } = sample(journal), m = await loadMessages(locale), view = fixture(); let saved = 0;
    const invalid = { ...row, values: { ...row.values, [journal.titleKey]: "" } };
    const input = { open: true, row: invalid, fields: journal.fields, templateCode: journal.code, hint: "", period, users: [], onOpenChange() {}, onSave: async () => { saved++; } };
    await view.render(locale, "register-document-client", "RowDialog", input); await view.render(locale, "register-document-client", "RowDialog", input); await view.button(m.genericRegister.actions.save)();
    assert.equal(saved, 0); assert.ok(view.errors[0].includes(presentRegisterField(journal.code, journal.fields.find(field => field.key === journal.titleKey)!, m).displayLabel));
    if (journal.dateKey) for (const choice of [true, false]) {
      const dates = fixture(); dates.confirm(choice); const outside = { ...input, row, period: { dateFrom: "2027-01-01", dateTo: "2027-12-31" } }; saved = 0;
      await dates.render(locale, "register-document-client", "RowDialog", outside); await dates.render(locale, "register-document-client", "RowDialog", outside); await dates.button(m.genericRegister.actions.save)();
      assert.equal(saved, choice ? 1 : 0); assert.equal(dates.confirmations[0].title, m.journalControls.dateInPeriod.title); assert.equal(dates.confirmations[0].locale, locale);
    }
    for (const useV2 of [false, true]) {
      const settings = fixture(); const input = { ...props, useV2 };
      await settings.render(locale, "register-document-client", "RegisterDocumentClient", input);
      (settings.find(node => typeof node.props.onSettings === "function").onSettings as () => void)(); await settings.render(locale, "register-document-client", "RegisterDocumentClient", input);
      (settings.find(node => node.props.id === "register-settings-title").onChange as (e: { target: { value: string } }) => void)({ target: { value: "Unsaved customer title" } });
      assert.ok((await settings.render("uz", "register-document-client", "RegisterDocumentClient", input)).includes("Unsaved customer title"));
      if (useV2) await (settings.find(node => node.props.size === "md" && typeof node.props.onSave === "function").onSave as () => Promise<void>)(); else await settings.button((await loadMessages("uz")).genericRegister.actions.save, true)();
      assert.equal(JSON.parse(String(settings.requests.at(-1)?.init?.body)).title, "Unsaved customer title");
    }
  }
});

test("deferred fetch/body feedback resolves current locale while preserving original submitted values", async () => {
  const journal = REGISTER_JOURNALS[0], { row, props, period } = sample(journal);
  for (const stage of ["fetch", "body"] as const) for (const ok of [true, false]) {
    const fetchPending = Promise.withResolvers<Response>(), body = Promise.withResolvers<unknown>();
    const response = { ok, status: ok ? 200 : 500, json: () => body.promise } as Response;
    const view = fixture(async () => stage === "fetch" ? fetchPending.promise : response);
    await view.render("en", "register-document-client", "RegisterDocumentClient", props);
    await view.button((await loadMessages("en")).genericRegister.actions.add)(); await view.render("en", "register-document-client", "RegisterDocumentClient", props);
    const save = view.find(node => "row" in node.props && typeof node.props.onSave === "function").onSave as (row: RegisterDocumentRow) => Promise<void>;
    const pending = save({ ...row, id: "new-original" }).catch(() => {});
    await view.render("uz", "register-document-client", "RegisterDocumentClient", props); fetchPending.resolve(response); body.resolve({ error: "RAW API PROSE" }); await pending;
    const payload = JSON.parse(String(view.requests[0].init?.body)); assert.equal(payload.title, journal.name); assert.equal(payload.config.rows[1].values.meal, row.values.meal);
    if (ok) assert.deepEqual(view.successes, [(await loadMessages("uz")).genericRegister.row.added]);
    assert.ok(![...view.errors, ...view.successes].some(value => value.includes("RAW API")));
  }
  const pending = Promise.withResolvers<void>(), dialog = fixture();
  const input = { open: true, row, fields: journal.fields, templateCode: journal.code, hint: "", period, users: [], onOpenChange() {}, onSave: () => pending.promise };
  await dialog.render("en", "register-document-client", "RowDialog", input); await dialog.render("en", "register-document-client", "RowDialog", input);
  const saving = dialog.button((await loadMessages("en")).genericRegister.actions.save)(); await tick(); await dialog.render("uz", "register-document-client", "RowDialog", input); pending.reject(new Error("RAW API PROSE")); await saving;
  assert.deepEqual(dialog.errors, [(await loadMessages("uz")).genericRegister.row.saveFailed]);
});

test("actual list PDF language chooser and pending deletion use current copy and original document ID", async () => {
  const journal = REGISTER_JOURNALS[0], { props } = sample(journal), pending = Promise.withResolvers<Response>();
  const view = fixture(() => pending.promise), document = { id: "original-id", title: "Customer title", status: "active", dateFrom: props.dateFrom, dateTo: props.dateTo, rowsCount: 2 };
  const input = { activeTab: "active", routeCode: journal.code, templateCode: journal.code, templateName: journal.name, users: [], documents: [document] };
  await view.render("en", "register-documents-client", "RegisterDocumentsClient", input);
  (view.find(node => typeof node.props.onPrint === "function").onPrint as () => void)(); assert.equal(view.exportChoices.length, 1); view.exportChoices[0]("uz"); assert.equal(view.downloads[0].href, "/api/journal-documents/original-id/pdf?locale=uz");
  (view.find(node => typeof node.props.onDelete === "function" && "siblings" in node.props).onDelete as () => void)(); await tick(); await view.render("uz", "register-documents-client", "RegisterDocumentsClient", input); pending.resolve(Response.json({})); await tick(); await tick();
  const t = createTranslator({ locale: "uz", messages: await loadMessages("uz"), namespace: "genericRegister" }); assert.deepEqual(view.successes, [t("list.deleted", { title: "Customer title" })]); assert.equal(view.requests[0].url, "/api/journal-documents/original-id"); assert.equal(view.requests[0].init?.method, "DELETE");
});

test("presentation guards preserve custom metadata options free text and calendar values without mutation", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const journal of REGISTER_JOURNALS) for (const field of journal.fields) {
      const before = JSON.stringify(field); const display = presentRegisterField(journal.code, field, messages);
      assert.equal(display.label, field.label); assert.equal(display.type, field.type); assert.deepEqual(display.options, field.options);
      const custom = { ...field, label: "Original customer label", placeholder: "Original placeholder", options: (field.options ?? []).map(option => ({ ...option, label: "Original custom option" })), showIf: { field: "original-key", equals: "Да" } };
      const shown = presentRegisterField(journal.code, custom, messages); assert.equal(shown.displayLabel, custom.label); assert.equal(shown.displayPlaceholder, custom.placeholder); assert.deepEqual(shown.showIf, custom.showIf); for (const option of shown.displayOptions ?? []) assert.equal(option.label, "Original custom option");
      assert.equal(registerCell(journal.code, { ...field, type: "text" }, "Допущено", locale, messages), "Допущено"); assert.equal(JSON.stringify(field), before);
    }
    assert.equal(registerDate("2026-02-30", locale), "2026-02-30"); assert.equal(registerDate("Customer date", locale), "Customer date");
  }
});

test("generated titles are display-only and custom journal/document names stay literal", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const journal of REGISTER_JOURNALS) {
    const messages = await loadMessages(locale), t = createTranslator({ locale, messages, namespace: "genericRegister" });
    const { props } = sample(journal);
    const original = buildDocumentAutoTitle({ templateCode: journal.code, journalName: journal.name, dateFrom: props.dateFrom, dateTo: props.dateTo });
    const display = registerTitle(original, journal.code, props.dateFrom, props.dateTo, locale, messages, t);
    assert.ok(display.includes(messages.journals.names[journal.code as keyof typeof messages.journals.names]));
    for (const custom of ["Customer journal", "Допущено", `${original} customer addition`]) {
      assert.equal(registerTitle(custom, journal.code, props.dateFrom, props.dateTo, locale, messages, t), custom);
      assert.equal(registerName(journal.code, custom, messages), custom);
    }
    const view = fixture(), input = { ...props, title: original, useV2: true };
    await view.render(locale, "register-document-client", "RegisterDocumentClient", input);
    (view.find(node => typeof node.props.onSettings === "function").onSettings as () => void)();
    await view.render(locale, "register-document-client", "RegisterDocumentClient", input);
    assert.equal(view.find(node => node.props.id === "register-settings-title").value, display);
    await (view.find(node => node.props.size === "md" && typeof node.props.onSave === "function").onSave as () => Promise<void>)();
    assert.equal(JSON.parse(String(view.requests[0].init?.body)).title, original);
  }
});

test("settings/delete/finish errors after deferred fetch or body use the current locale and preserve submitted data", async () => {
  const journal = REGISTER_JOURNALS[0], { props } = sample(journal);
  for (const stage of ["fetch", "body"] as const) for (const operation of ["settings", "delete", "finish"] as const) {
    const fetchPending = Promise.withResolvers<Response>(), body = Promise.withResolvers<unknown>();
    const response = { ok: false, status: 500, json: () => body.promise } as Response;
    const view = fixture(async () => stage === "fetch" ? fetchPending.promise : response), input = { ...props, useV2: true };
    await view.render("en", "register-document-client", "RegisterDocumentClient", input);
    let pending: Promise<void> | undefined;
    if (operation === "settings") {
      (view.find(node => typeof node.props.onSettings === "function").onSettings as () => void)();
      await view.render("en", "register-document-client", "RegisterDocumentClient", input);
      pending = (view.find(node => node.props.size === "md" && typeof node.props.onSave === "function").onSave as () => Promise<void>)();
    } else if (operation === "delete") {
      (view.find(node => node.props["aria-label"] === "Select all entries").onCheckedChange as (checked: boolean) => void)(true);
      await view.render("en", "register-document-client", "RegisterDocumentClient", input);
      (view.find(node => node.props.hint === "Selected entries will be permanently deleted").onDelete as () => void)();
    } else {
      const menu = view.find(node => Array.isArray(node.props.menuItems)).menuItems as { onSelect: () => void }[]; menu[0].onSelect();
    }
    await tick(); await view.render("uz", "register-document-client", "RegisterDocumentClient", input);
    fetchPending.resolve(response); body.resolve({ error: "RAW SERVER PROSE" }); await pending; await tick(); await tick();
    const m = (await loadMessages("uz")).genericRegister;
    assert.deepEqual(view.errors, [operation === "settings" ? m.settings.saveFailed : operation === "delete" ? m.selection.deleteFailed : m.finish.failed]);
    assert.equal(JSON.parse(String(view.requests[0].init?.body)).title, journal.name);
    assert.deepEqual(view.navigations, []);
  }
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
    if (typeof type === "function" && ["RowDialog", "CreateDocumentDialog"].includes(type.name)) return fn(inline, {}, key);
    return fn(type as React.ElementType, props, key);
  };
  const cache = new Map<string, Record<string, unknown>>();
  function load(name: string): Record<string, unknown> {
    if (cache.has(name)) return cache.get(name)!;
    const filename = `src/components/journals/${name}.${["use-generic-register-copy", "use-auto-document-title", "use-sequential-edit", "use-journal-document-actions", "confirm-date-in-period"].includes(name) ? "ts" : "tsx"}`;
    let code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    if (name === "register-document-client") code += "\nexports.RowDialog=RowDialog; exports.SettingsFields=SettingsFields;";

    const fixtureModule = { exports: {} }; cache.set(name, fixtureModule.exports);
    const dependencies = new Set(["use-generic-register-copy", "use-auto-document-title", "use-sequential-edit", "use-document-dialog-submit", "use-journal-document-actions", "confirm-date-in-period"]);
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

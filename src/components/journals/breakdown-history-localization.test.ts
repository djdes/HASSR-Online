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
import { BREAKDOWN_HISTORY_DOCUMENT_TITLE, createBreakdownRow } from "@/lib/breakdown-history-document";
import { breakdownEnd } from "./breakdown-history-presentation";
import { BreakdownHistoryDocumentClient } from "./breakdown-history-document-client";
import { BreakdownHistoryDocumentsClient } from "./breakdown-history-documents-client";

const require = createRequire(import.meta.url);
type Node = { type: unknown; props: Record<string, unknown> };
const inline = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = (value: unknown): string => Array.isArray(value) ? value.map(text).join("") : typeof value === "string" ? value : "";
const directory = [{ id: "equipment-id", name: "Renamed O‘rik equipment" }];
const row = createBreakdownRow({ id: "original-row", startDate: "2026-10-15", startHour: "23", startMinute: "30", endDate: "2026-10-16", endHour: "01", endMinute: "05", sourceEquipmentId: "equipment-id", equipmentName: "Original equipment", breakdownDescription: "Original description", repairPerformed: "Original repair", partsReplaced: "Original parts", downtimeHours: "1,5", responsiblePerson: "Original person" });
const props = { documentId: "original-document", title: BREAKDOWN_HISTORY_DOCUMENT_TITLE, organizationName: "Original organization", dateFrom: "2026-10-01", status: "active", config: { rows: [row] }, equipmentDirectory: directory };

async function render(locale: Locale, child: React.ReactNode, navigate: (url: string) => void = () => {}) {
  return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: { back() {}, forward() {}, refresh() {}, push: navigate, replace() {}, prefetch() {} }, children: React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams(), children: React.createElement(NextIntlClientProvider, { locale, messages: await loadMessages(locale), timeZone: "UTC", onError: error => { throw error; }, children: child }) }) })).replaceAll("&#x27;", "'");
}

test("breakdown active/closed/empty list and detail render all locales preserving equipment and customer data", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const m = (await loadMessages(locale)).breakdownHistory;
    assert.deepEqual(validateCatalog((await loadMessages("ru")).breakdownHistory, m), []);
    for (const status of ["active", "closed"] as const) for (const rows of [[row], []]) {
      const before = JSON.stringify(rows);
      const html = await render(locale, React.createElement(BreakdownHistoryDocumentClient, { ...props, status, config: { rows } }));
      for (const expected of [m.title, m.columns.description, m.columns.repair, m.columns.endTime]) assert.ok(html.includes(expected), locale + ": " + expected);
      if (rows.length) for (const expected of [directory[0].name, row.breakdownDescription, row.responsiblePerson, "23:30", "01:05", "1,5"]) assert.ok(html.includes(expected), expected);
      if (locale !== "ru") assert.doesNotMatch(html, /Карточка истории поломок|Выполненный ремонт|Часы простоя/);
      assert.equal(JSON.stringify(rows), before);
      const list = await render(locale, React.createElement(BreakdownHistoryDocumentsClient, { activeTab: status, routeCode: "breakdown_history", templateCode: "breakdown_history", documents: [{ id: "original", title: "Custom title", status, dateFrom: "2026-10-01", config: {} }] }));
      assert.ok(list.includes(m.title) && list.includes("Custom title"));
    }
    assert.equal(breakdownEnd({ ...row, endDate: "" }, locale), "");
    assert.ok(!breakdownEnd({ ...row, endHour: "", endMinute: "" }, locale).includes(":"));
  }
});

test("breakdown real row form saves and reopens unchanged values and retains locale-switch drafts", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const view = fixture(); const m = (await loadMessages(locale)).breakdownHistory; let saved = row;
    const input = { open: true, initialRow: row, documentId: "original-document", directory, onOpenChange() {}, onSave: async (value: typeof row) => { saved = value; } };
    await view.render(locale, "breakdown-history-document-client", "RowDialog", input);
    const field = view.find(node => node.props["aria-label"] === m.columns.description && typeof node.props.onChange === "function");
    (field.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Unsaved O‘zgarmas repair" } });
    assert.ok((await view.render("uz", "breakdown-history-document-client", "RowDialog", input)).includes("Unsaved O‘zgarmas repair"));
    await view.render(locale, "breakdown-history-document-client", "RowDialog", input); await view.button(m.actions.save)();
    assert.deepEqual(JSON.parse(JSON.stringify(saved)), { ...row, breakdownDescription: "Unsaved O‘zgarmas repair" });
    const reopen = fixture(); assert.ok((await reopen.render(locale, "breakdown-history-document-client", "RowDialog", { ...input, initialRow: saved })).includes(saved.breakdownDescription));
  }
});

test("breakdown real mobile cards render translated fields and preserve open-repair values", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const view = fixture();
    await view.render(locale, "breakdown-history-document-client", "BreakdownHistoryDocumentClient", { ...props, config: { rows: [row, { ...row, id: "open-row", endDate: "", endHour: "", endMinute: "" }] } });
    const cards = view.nodes.find(node => typeof node.type === "function" && node.type.name === "RecordCardsView"); assert.ok(cards);
    const html = await render(locale, React.createElement(cards.type as React.ComponentType<Record<string, unknown>>, { ...cards.props, defaultExpandFirst: true }));
    const m = (await loadMessages(locale)).breakdownHistory;
    for (const expected of [m.columns.description, m.columns.repair, m.cards.parts, m.cards.end, m.cards.responsible, directory[0].name, row.responsiblePerson, "23:30", "01:05"]) assert.ok(html.includes(expected), expected);
    if (locale !== "ru") assert.doesNotMatch(html, /изменить|Нет записей/);
    const items = cards.props.items as { id: string; fields: { label: string; value: string }[] }[];
    assert.equal(items.find(item => item.id === "open-row")!.fields.find(field => field.label === m.cards.end)!.value, "");
  }
});

test("breakdown actual date validation rejects earlier completion and preserves open/equal/next-day repairs", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const ending of ["before", "equal", "after", "open"] as const) {
    const view = fixture(); let count = 0; const m = (await loadMessages(locale)).breakdownHistory;
    const initialRow = { ...row, endDate: ending === "open" ? "" : ending === "after" ? "2026-10-16" : row.startDate, endHour: ending === "before" ? "22" : row.startHour, endMinute: row.startMinute };
    const html = await view.render(locale, "breakdown-history-document-client", "RowDialog", { open: true, initialRow, documentId: "original-document", directory, onOpenChange() {}, onSave: async () => { count++; } });
    const save = view.find(node => typeof node.props.onClick === "function" && text(node.props.children) === m.actions.save);
    assert.equal(save.disabled, ending === "before");
    await (save.onClick as () => Promise<void>)(); assert.equal(count, ending === "before" ? 0 : 1);
    assert.equal(html.includes(m.row.dateError), ending === "before");
    if (ending === "before") assert.deepEqual(view.errors, [m.row.dateError]);
  }
});

test("breakdown actual add, sequential edit and selected delete PATCH only config without changing source IDs", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const view = fixture(); const m = (await loadMessages(locale)).breakdownHistory;
    const input = { ...props, config: { rows: [row, { ...row, id: "second-row" }] } };
    await view.render(locale, "breakdown-history-document-client", "BreakdownHistoryDocumentClient", input);
    await view.button(m.actions.add)(); await view.render(locale, "breakdown-history-document-client", "BreakdownHistoryDocumentClient", input);
    let dialog = view.find(node => "initialRow" in node.props && typeof node.props.onSave === "function");
    await (dialog.onSave as (value: typeof row) => Promise<void>)({ ...row, id: "added-row", endDate: "", endHour: "", endMinute: "" });
    await view.render(locale, "breakdown-history-document-client", "BreakdownHistoryDocumentClient", input);
    let payload = JSON.parse(String(view.requests.at(-1)?.init?.body)); assert.deepEqual(Object.keys(payload), ["config"]); assert.equal(payload.config.rows[2].endDate, "");
    const select = view.find(node => node.props["aria-label"] === m.actions.selectAll); (select.onCheckedChange as (value: boolean) => void)(true);
    await view.render(locale, "breakdown-history-document-client", "BreakdownHistoryDocumentClient", input);
    const edit = view.find(node => typeof node.type === "function" && node.type.name === "SelectionEditButton"); (edit.onClick as () => void)();
    for (const id of ["original-row", "second-row", "added-row"]) {
      await view.render(locale, "breakdown-history-document-client", "BreakdownHistoryDocumentClient", input);
      dialog = view.find(node => "initialRow" in node.props && typeof node.props.onSave === "function");
      assert.equal((dialog.initialRow as typeof row).id, id);
      await (dialog.onSave as (value: typeof row) => Promise<void>)({ ...dialog.initialRow as typeof row, repairPerformed: `Edited ${id}` });
      payload = JSON.parse(String(view.requests.at(-1)?.init?.body)); assert.deepEqual(Object.keys(payload), ["config"]); assert.equal(payload.config.rows.find((item: typeof row) => item.id === id).sourceEquipmentId, row.sourceEquipmentId);
    }
    await view.render(locale, "breakdown-history-document-client", "BreakdownHistoryDocumentClient", input);
    const selection = view.find(node => node.props.hint === m.delete.hint); (selection.onDelete as () => void)(); await tick(); await tick();
    payload = JSON.parse(String(view.requests.at(-1)?.init?.body)); assert.deepEqual(payload, { config: { rows: [] } });
    for (const request of view.requests) assert.equal(request.init?.method, "PATCH");
  }
});

test("breakdown both settings variants retain drafts and close changes only status", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    for (const useV2 of [false, true]) {
      const view = fixture(); const submitted: unknown[] = []; const input = { open: true, title: "Custom title", dateFrom: "2026-10-01", useV2, onOpenChange() {}, onSave: async (value: unknown) => { submitted.push(value); } };
      await view.render(locale, "breakdown-history-document-client", "SettingsDialog", input);
      const field = view.find(node => node.props.value === "Custom title" && typeof node.props.onChange === "function"); (field.onChange as (e: { target: { value: string } }) => void)({ target: { value: "Unsaved custom title" } });
      assert.ok((await view.render("uz", "breakdown-history-document-client", "SettingsDialog", input)).includes("Unsaved custom title"));
      if (useV2) { const modal = view.find(node => node.props.size === "md" && typeof node.props.onSave === "function"); await (modal.onSave as () => Promise<void>)(); }
      else await view.button((await loadMessages("uz")).breakdownHistory.actions.save)();
      assert.deepEqual(JSON.parse(JSON.stringify(submitted)), [{ title: "Unsaved custom title", dateFrom: "2026-10-01" }]);
    }
    const close = fixture(); await close.render(locale, "breakdown-history-document-client", "FinishDialog", { open: true, title: "Original title", documentId: "original-document", onOpenChange() {}, onFinished() {} });
    await close.button((await loadMessages(locale)).breakdownHistory.actions.finishShort)();
    assert.deepEqual(JSON.parse(String(close.requests[0].init?.body)), { status: "closed" });
  }
});

test("breakdown deferred final sequential save uses current-language summary without changing row IDs or progression", async () => {
  const finalResponse = Promise.withResolvers<Response>(); let requests = 0;
  const view = fixture(async () => ++requests === 2 ? finalResponse.promise : Response.json({ ok: true }));
  const input = { ...props, config: { rows: [row, { ...row, id: "second-row" }] } };
  await view.render("en", "breakdown-history-document-client", "BreakdownHistoryDocumentClient", input);
  const en = (await loadMessages("en")).breakdownHistory;
  const select = view.find(node => node.props["aria-label"] === en.actions.selectAll); (select.onCheckedChange as (value: boolean) => void)(true);
  await view.render("en", "breakdown-history-document-client", "BreakdownHistoryDocumentClient", input);
  const edit = view.find(node => typeof node.type === "function" && node.type.name === "SelectionEditButton"); (edit.onClick as () => void)();
  await view.render("en", "breakdown-history-document-client", "BreakdownHistoryDocumentClient", input);
  let dialog = view.find(node => "initialRow" in node.props && typeof node.props.onSave === "function");
  await (dialog.onSave as (value: typeof row) => Promise<void>)({ ...dialog.initialRow as typeof row, repairPerformed: "First saved" });
  await view.render("en", "breakdown-history-document-client", "BreakdownHistoryDocumentClient", input);
  dialog = view.find(node => "initialRow" in node.props && typeof node.props.onSave === "function"); assert.equal((dialog.initialRow as typeof row).id, "second-row");
  const pending = (dialog.onSave as (value: typeof row) => Promise<void>)({ ...dialog.initialRow as typeof row, repairPerformed: "Second saved" });
  await view.render("uz", "breakdown-history-document-client", "BreakdownHistoryDocumentClient", input);
  finalResponse.resolve(Response.json({ ok: true })); await pending;
  const t = createTranslator({ locale: "uz", messages: await loadMessages("uz"), namespace: "journalControls.selection" });
  assert.deepEqual(view.successes, [t("summary", { done: 2, total: 2 })]);
  const payload = JSON.parse(String(view.requests[1].init?.body)); assert.deepEqual(Object.keys(payload), ["config"]); assert.deepEqual(payload.config.rows.map((item: typeof row) => item.id), ["original-row", "second-row"]);
  await view.render("uz", "breakdown-history-document-client", "BreakdownHistoryDocumentClient", input);
  assert.equal(view.nodes.some(node => "initialRow" in node.props && typeof node.props.onSave === "function"), false);
});

test("breakdown create duplicate/force preserves annual period, custom title and historical alias navigation", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    let attempts = 0; const view = fixture(async () => ++attempts === 1 ? Response.json({ existing: { id: "existing-id", title: "Original existing title" } }, { status: 409 }) : Response.json({ document: { id: "created-id" } }));
    const input = { activeTab: "active", routeCode: "breakdownhistoryjournal", templateCode: "breakdown_history", documents: [] };
    const m = (await loadMessages(locale)).breakdownHistory;
    await view.render(locale, "breakdown-history-documents-client", "BreakdownHistoryDocumentsClient", input); await view.button(m.actions.createDocument)();
    await view.render(locale, "breakdown-history-documents-client", "BreakdownHistoryDocumentsClient", input); await view.render(locale, "breakdown-history-documents-client", "BreakdownHistoryDocumentsClient", input);
    const field = view.find(node => typeof node.props.value === "string" && node.props.value.includes(m.title) && typeof node.props.onChange === "function"); (field.onChange as (e: { target: { value: string } }) => void)({ target: { value: "Customer O‘zgarmas title" } });
    assert.ok((await view.render("uz", "breakdown-history-documents-client", "BreakdownHistoryDocumentsClient", input)).includes("Customer O‘zgarmas title"));
    await view.button((await loadMessages("uz")).breakdownHistory.actions.create)(); await tick();
    const html = await view.render("uz", "breakdown-history-documents-client", "BreakdownHistoryDocumentsClient", input); assert.ok(html.includes("Original existing title"));
    const first = JSON.parse(String(view.requests[0].init?.body)); assert.equal(first.title, "Customer O‘zgarmas title"); assert.equal(first.templateCode, "breakdown_history"); assert.ok(first.dateFrom.endsWith("-01-01") && first.dateTo.endsWith("-12-31"));
    await view.button((await loadMessages("uz")).journalControls.documentDialog.forceCreate)(); await tick();
    assert.deepEqual(JSON.parse(String(view.requests[1].init?.body)), { ...first, force: true }); assert.ok(view.navigations.includes("/journals/breakdownhistoryjournal/documents/created-id"));
  }
});

test("breakdown actual list PDF requests locale before downloading original encoded document ID", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const view = fixture(); await view.render(locale, "breakdown-history-documents-client", "BreakdownHistoryDocumentsClient", { activeTab: "active", routeCode: "breakdown_history", templateCode: "breakdown_history", documents: [{ id: "original/id", title: "Custom title", status: "active", dateFrom: "2026-10-01", config: {} }] });
    const menu = view.find(node => Array.isArray(node.props.items) && node.props.items.some(item => item.key === "print"));
    (menu.items as { key: string; onSelect(): void }[]).find(item => item.key === "print")!.onSelect();
    assert.equal(view.exportChoices.length, 1); assert.equal(view.downloads.length, 0); view.exportChoices[0](locale);
    assert.deepEqual(view.downloads, [{ href: `/api/journal-documents/original%2Fid/pdf?locale=${locale}`, target: "_blank", rel: "noopener noreferrer" }]);
  }
});

test("breakdown actual list delete and detail settings preserve their document ID and payload fields", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const m = (await loadMessages(locale)).breakdownHistory;
    const list = fixture(); const input = { activeTab: "active", routeCode: "breakdown_history", templateCode: "breakdown_history", documents: [{ id: "original-delete-id", title: "Original title", status: "active", dateFrom: "2026-10-01", config: {} }] };
    await list.render(locale, "breakdown-history-documents-client", "BreakdownHistoryDocumentsClient", input);
    const menu = list.find(node => Array.isArray(node.props.items) && node.props.items.some(item => item.key === "delete"));
    (menu.items as { key: string; onSelect(): void }[]).find(item => item.key === "delete")!.onSelect();
    await list.render(locale, "breakdown-history-documents-client", "BreakdownHistoryDocumentsClient", input); await list.button(m.actions.delete)();
    assert.equal(list.requests[0].url, "/api/journal-documents/original-delete-id"); assert.equal(list.requests[0].init?.method, "DELETE"); assert.equal(list.requests[0].init?.body, undefined);
    const detail = fixture(); await detail.render(locale, "breakdown-history-document-client", "BreakdownHistoryDocumentClient", props);
    const shell = detail.find(node => typeof node.props.onSettings === "function"); (shell.onSettings as () => void)();
    await detail.render(locale, "breakdown-history-document-client", "BreakdownHistoryDocumentClient", props);
    const settings = detail.find(node => typeof node.props.onSave === "function" && node.props.title === props.title);
    await (settings.onSave as (value: { title: string; dateFrom: string }) => Promise<void>)({ title: "Custom changed title", dateFrom: "2026-10-02" });
    assert.equal(detail.requests[0].url, "/api/journal-documents/original-document"); assert.deepEqual(JSON.parse(String(detail.requests[0].init?.body)), { title: "Custom changed title", dateFrom: "2026-10-02", config: props.config });
  }
});

test("breakdown pending row/settings/delete/close failure uses current locale and retains dialogs", async () => {
  for (const kind of ["row", "settings", "delete", "finish"] as const) {
    const pending = Promise.withResolvers<Response>(); const view = fixture(async () => pending.promise); let closed = 0;
    const onOpenChange = (open: boolean) => { if (!open) closed++; }; const failing = async () => { await pending.promise; throw new Error("RAW ERROR"); };
    const file = kind === "delete" ? "breakdown-history-documents-client" : "breakdown-history-document-client";
    const component = { row: "RowDialog", settings: "SettingsDialog", delete: "DeleteDialog", finish: "FinishDialog" }[kind];
    const input = kind === "row" ? { open: true, initialRow: row, directory, documentId: "original-document", onOpenChange, onSave: failing } : kind === "settings" ? { open: true, title: "Custom title", dateFrom: "2026-10-01", onOpenChange, onSave: failing } : kind === "delete" ? { open: true, title: "Custom title", onOpenChange, onConfirm: failing } : { open: true, title: "Custom title", documentId: "original-document", onOpenChange, onFinished() {} };
    await view.render("en", file, component, input); const en = (await loadMessages("en")).breakdownHistory;
    const action = view.button(kind === "delete" ? en.actions.delete : kind === "finish" ? en.actions.finishShort : en.actions.save)();
    await view.render("uz", file, component, input); pending.resolve(Response.json({ error: "RAW API ERROR" }, { status: 500 })); await action;
    assert.equal(closed, 0); assert.deepEqual(view.errors, [(await loadMessages("uz")).breakdownHistory.errors[kind === "finish" ? "generic" : kind]]);
  }
});

test("shared record cards translate chrome while preserving expand/edit callbacks, custom fields and empty overrides", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const view = fixture(); let rowEdits = 0, fieldEdits = 0;
    const items = [{ id: "original-card", title: "Original customer title", onClick() { rowEdits++; }, fields: [{ label: "Original field", value: "Original value", hint: "Original hint", onClick() { fieldEdits++; } }] }];
    const input = { items }; const m = (await loadMessages(locale)).journalControls.recordCards;
    const collapsed = await view.render(locale, "record-cards-view", "RecordCardsView", input); assert.ok(collapsed.includes(m.edit) && collapsed.includes("Original customer title")); assert.ok(!collapsed.includes("Original hint"));
    const expand = view.find(node => node.props["aria-expanded"] === false); (expand.onClick as () => void)();
    const expanded = await view.render(locale, "record-cards-view", "RecordCardsView", input); for (const expected of ["Original field", "Original value", "Original hint", m.edit]) assert.ok(expanded.includes(expected));
    await view.button(m.edit)(); assert.equal(rowEdits, 1);
    const field = view.find(node => node.type === "button" && typeof node.props.className === "string" && node.props.className.includes("flex-col") && typeof node.props.onClick === "function");
    let stopped = false; (field.onClick as (event: { stopPropagation(): void }) => void)({ stopPropagation() { stopped = true; } }); assert.equal(fieldEdits, 1); assert.equal(stopped, true);
    assert.ok((await fixture().render(locale, "record-cards-view", "RecordCardsView", { items: [] })).includes(m.empty));
    const customEmpty = await fixture().render(locale, "record-cards-view", "RecordCardsView", { items: [], emptyLabel: "Custom empty value" }); assert.ok(customEmpty.includes("Custom empty value") && !customEmpty.includes(m.empty));
    assert.ok(!(await fixture().render(locale, "record-cards-view", "RecordCardsView", { items: [], emptyLabel: "" })).includes(m.empty));
  }
});

test("shared equipment directory preserves link/custom callbacks and current-locale deferred fetch/body feedback", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const changes: unknown[] = []; const view = fixture(); const input = { value: "Original equipment", sourceEquipmentId: "equipment-id", directory, documentId: "original-document", onChange: (name: string, id: string | null) => changes.push({ name, id }) };
    const html = await view.render(locale, "equipment-directory-field", "EquipmentDirectoryField", input); assert.ok(html.includes(directory[0].name));
    await view.button((await loadMessages(locale)).journalControls.equipmentDirectory.unlink)(); assert.deepEqual(changes, [{ name: directory[0].name, id: null }]);
    await view.render(locale, "equipment-directory-field", "EquipmentDirectoryField", { ...input, sourceEquipmentId: null, value: "Custom text", label: "Custom field name" });
    const control = view.find(node => node.props.ariaLabel === "Custom field name"); (control.onChange as (value: string) => void)(directory[0].name); assert.deepEqual(changes.at(-1), { name: directory[0].name, id: "equipment-id" });
    (control.onChange as (value: string) => void)("Unmatched custom text"); assert.deepEqual(changes.at(-1), { name: "Unmatched custom text", id: null });
  }
  for (const stage of ["fetch", "body"] as const) for (const outcome of ["created", "linked", "forbidden"] as const) {
    const success = outcome !== "forbidden";
    const pendingResponse = Promise.withResolvers<Response>(), pendingBody = Promise.withResolvers<unknown>(); const changes: unknown[] = [];
    const response = { ok: success, status: success ? 200 : 403, json: async () => pendingBody.promise } as Response;
    const view = fixture(async () => stage === "fetch" ? pendingResponse.promise : response);
    const input = { value: "  Custom O‘rik  ", sourceEquipmentId: null, directory: [], documentId: "original-document", onChange: (name: string, id: string | null) => changes.push({ name, id }) };
    await view.render("en", "equipment-directory-field", "EquipmentDirectoryField", input); await view.button((await loadMessages("en")).journalControls.equipmentDirectory.add)();
    await view.render("uz", "equipment-directory-field", "EquipmentDirectoryField", input); pendingResponse.resolve(response); pendingBody.resolve({ created: outcome === "created", equipment: { id: "server-id", name: "Server original name" }, error: "RAW API TEXT" }); await tick(); await tick();
    assert.deepEqual(JSON.parse(String(view.requests[0].init?.body)), { name: "Custom O‘rik" });
    const m = (await loadMessages("uz")).journalControls.equipmentDirectory;
    if (success) { assert.deepEqual(view.successes, [m[outcome]]); assert.deepEqual(changes, [{ name: "Server original name", id: "server-id" }]); }
    else { assert.deepEqual(view.errors, [m.forbidden]); assert.deepEqual(changes, []); }
  }
});

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
  const wrap = (fn: typeof jsxRuntime.jsx) => (type: unknown, props: Node["props"], key?: string) => {
    nodes.push({ type, props });
    // Parent-handler checks capture keyed row-dialog props; standalone row tests
    // execute its real body. A flat hook store does not model keyed remounts.
    if (typeof type === "function" && (type.name === "RowDialog" || (type.name === "SettingsDialog" && "onSave" in props))) return fn(inline, {}, key);
    return fn(type as React.ElementType, props, key);
  };
  const cache = new Map<string, Record<string, unknown>>();
  function load(name: string): Record<string, unknown> {
    if (cache.has(name)) return cache.get(name)!;
    const filename = `src/components/journals/${name}.${["use-breakdown-copy", "use-auto-document-title", "use-sequential-edit", "use-journal-document-actions"].includes(name) ? "ts" : "tsx"}`;
    let code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    if (name === "breakdown-history-document-client") code += "\nexports.RowDialog=RowDialog; exports.SettingsDialog=SettingsDialog; exports.FinishDialog=FinishDialog;";
    if (name === "breakdown-history-documents-client") code += "\nexports.SettingsDialog=SettingsDialog; exports.DeleteDialog=DeleteDialog;";
    const fixtureModule = { exports: {} }; cache.set(name, fixtureModule.exports);
    const dependencies = new Set(["use-breakdown-copy", "use-auto-document-title", "use-sequential-edit", "use-document-dialog-submit", "use-journal-document-actions", "time-field", "equipment-directory-field"]);
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

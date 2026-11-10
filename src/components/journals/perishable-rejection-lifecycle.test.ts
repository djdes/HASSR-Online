/* eslint-disable react/no-children-prop -- Explicit providers for isolated production-component handlers. */
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
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import { normalizePerishableRejectionConfig, type PerishableRejectionConfig } from "@/lib/perishable-rejection-document";
import type { PerishableRejectionDocumentClient } from "./perishable-rejection-document-client";

const require = createRequire(import.meta.url);
type Node = { type: unknown; props: Record<string, unknown> };
const inline = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const messages = (locale: Locale) => loadMessages(locale);
const tick = () => new Promise(resolve => setImmediate(resolve));
function text(value: unknown): string { if (Array.isArray(value)) return value.map(text).join(""); return typeof value === "string" ? value : ""; }

function fixture(initialConfig: unknown = {}, fetcher: typeof fetch = async () => Response.json({})) {
  const filename = "src/components/journals/perishable-rejection-document-client.tsx";
  const code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const fixtureModule = { exports: {} };
  let cursor = 0, refCursor = 0, timerId = 0;
  let promptResult: string | null = null;
  const states: unknown[] = [], refs: { current: unknown }[] = [], nodes: Node[] = [], effects: (() => void)[] = [];
  const timers = new Map<number, () => void>();
  const errors: string[] = [], successes: string[] = [], requests: { url: string; init?: RequestInit }[] = [], prompts: Record<string, unknown>[] = [], confirms: Record<string, unknown>[] = [];
  const wrap = (fn: typeof jsxRuntime.jsx) => (type: unknown, props: Node["props"], key?: string) => { nodes.push({ type, props }); return fn(type as React.ElementType, props, key); };
  const mocks: Record<string, unknown> = {
    react: { ...React,
      useState: (fallback: unknown) => { const index = cursor++; if (index >= states.length) states[index] = typeof fallback === "function" ? fallback() : fallback; return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
      useRef: (value: unknown) => { const index = refCursor++; return refs[index] ?? (refs[index] = { current: value }); },
      useEffect: (effect: () => void) => effects.push(effect),
    },
    "react/jsx-runtime": { ...jsxRuntime, jsx: wrap(jsxRuntime.jsx), jsxs: wrap(jsxRuntime.jsxs) },
    "@/components/ui/dialog": { Dialog: inline, DialogContent: inline, DialogHeader: inline, DialogTitle: inline },
    "@/components/journals/use-name-suggestions": { useNameSuggestions: () => ({ options: (items: string[]) => items, remember: async () => {} }) },
    "@/lib/use-live-events": { useLiveEvents: () => {} },
    "@/components/ui/prompt-async": { promptAsync: async (options: Record<string, unknown>) => { prompts.push(options); return promptResult; } },
    "@/components/ui/confirm-async": { confirmAsync: async (options: Record<string, unknown>) => { confirms.push(options); return true; } },
    sonner: { toast: { error: (value: string) => errors.push(value), success: (value: string) => successes.push(value) } },
  };
  vm.runInNewContext(code, { module: fixtureModule, exports: fixtureModule.exports, Error, Date,
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; }, clearTimeout: (id: number) => timers.delete(id),
    fetch: async (url: string, init?: RequestInit) => { requests.push({ url, init }); return fetcher(url, init); },
    require: (id: string) => Object.hasOwn(mocks, id) ? mocks[id] : id.startsWith("./") ? require("@/components/journals/" + id.slice(2)) : require(id),
  });
  const component = fixtureModule.exports as { PerishableRejectionDocumentClient: typeof PerishableRejectionDocumentClient };
  return {
    nodes, states, errors, successes, requests, prompts, confirms,
    setPromptResult(value: string | null) { promptResult = value; },
    get config() { return states[1] as PerishableRejectionConfig; },
    find(predicate: (node: Node) => boolean) { const found = nodes.find(predicate); assert.ok(found, "Expected rendered control"); return found.props; },
    button(label: string) { const found = nodes.find(node => typeof node.props.onClick === "function" && text(node.props.children) === label); assert.ok(found, `Expected button ${label}`); return found.props.onClick as () => void; },
    async flush() { const pending = [...timers.values()]; timers.clear(); for (const callback of pending) callback(); await tick(); },
    async render(locale: Locale, status: "active" | "closed" = "active") {
      cursor = 0; refCursor = 0; nodes.length = 0; effects.length = 0;
      const html = renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router, children: React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams(), children: React.createElement(NextIntlClientProvider, { locale, messages: await messages(locale), timeZone: "UTC", onError: error => { throw error; }, children: React.createElement(component.PerishableRejectionDocumentClient, { documentId: "doc-original", title: "Custom title", organizationName: "Original organization", dateFrom: "2026-10-01", initialConfig: normalizePerishableRejectionConfig(initialConfig), status, users: [{ id: "employee-1", name: "O‘tkir", role: "cook" }], responsibleUserId: "employee-1" }) }) }) })).replaceAll("&#x27;", "'");
      for (const effect of effects) effect();
      return html;
    },
  };
}

test("perishable real add/edit/settings/list dialogs and canonical options render RU/EN/UZ", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const view = fixture({ productLists: [{ id: "list-1", name: "Original list", items: ["Original product"] }], manufacturers: ["Original manufacturer"], suppliers: ["Original supplier"] });
    const m = (await messages(locale)).perishableRejection;
    const html = await view.render(locale);
    for (const expected of [m.fields.arrival, m.fields.product, m.fields.organoleptic, m.expiry.label, m.paste.description, m.settings.name, m.lists.productLists, "Original list"]) assert.ok(html.includes(expected), `${locale}: ${expected}`);
    for (const value of ["compliant", "non_compliant", "good_quality", "poor_quality"] as const) assert.ok(html.includes(m.organoleptic[value]));
    for (const value of ["2_6", "minus18", "minus2_2"] as const) assert.ok(html.includes(m.storage[value]));
    for (const section of ["manufacturers", "suppliers"] as const) {
      view.button(m.lists[section])(); const sectionHtml = await view.render(locale);
      assert.ok(sectionHtml.includes(section === "manufacturers" ? "Original manufacturer" : "Original supplier"));
      assert.ok(view.nodes.some(node => typeof node.props["aria-label"] === "string" && String(node.props["aria-label"]).includes("Original")));
    }
    if (locale !== "ru") assert.doesNotMatch(html, /Добавление новой строки|Наименование изделия|Органолептическая оценка|Изготовители|Сохранение|Кнопки отсчитывают/);
  }
});

test("actual row create/save/reopen/edit and locale switching preserve drafts, canonical options, snapshots and PATCH payload", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const m = (await messages(locale)).perishableRejection;
    const view = fixture(); await view.render(locale); view.button(m.actions.addRow)(); await view.render(locale);
    const input = view.find(node => node.props.ariaLabel === m.fields.product);
    (input.onChange as (value: string) => void)("Original O‘rik");
    const grade = view.find(node => node.props.role === "radio" && Boolean(node.props.children) && text(node.props.children).includes(m.organoleptic.poor_quality));
    (grade.onClick as () => void)();
    const storage = view.find(node => typeof node.props.onClick === "function" && React.isValidElement<{ children?: React.ReactNode }>((node.props.children as React.ReactNode[])?.[0]) && ((node.props.children as React.ReactElement<{ children?: React.ReactNode }>[])[0].props.children === m.storage.minus18));
    (storage.onClick as () => void)();
    const switched = await view.render(locale === "en" ? "uz" : "en"); assert.ok(switched.includes("Original O‘rik"));
    await view.render(locale);
    const submit = view.nodes.filter(node => typeof node.props.onClick === "function" && text(node.props.children) === m.actions.addRow).at(-1)!;
    (submit.props.onClick as () => void)(); await view.render(locale); await view.flush();
    assert.equal(view.config.rows.length, 1);
    const row = view.config.rows[0]; assert.equal(row.productName, "Original O‘rik"); assert.equal(row.organolepticResult, "poor_quality"); assert.equal(row.storageCondition, "minus18"); assert.equal(row.responsiblePerson, "O‘tkir, Повар");
    const saved = JSON.parse(String(view.requests.at(-1)?.init?.body));
    assert.equal(view.requests.at(-1)?.url, "/api/journal-documents/doc-original"); assert.equal(view.requests.at(-1)?.init?.method, "PATCH"); assert.equal(saved.config.rows[0].id, row.id); assert.ok(saved.knownRowIds.includes(row.id));
    const reopened = fixture(saved.config); const html = await reopened.render(locale); assert.ok(html.includes("Original O‘rik"));
    const openCell = reopened.find(node => typeof node.props.onOpen === "function"); (openCell.onOpen as () => void)(); await reopened.render(locale);
    const editor = reopened.find(node => node.props.ariaLabel === m.fields.product); (editor.onChange as (value: string) => void)("Edited original"); await reopened.render(locale);
    reopened.button(m.actions.save)(); await reopened.render(locale); await reopened.flush();
    assert.equal(reopened.config.rows[0].id, row.id); assert.equal(reopened.config.rows[0].productName, "Edited original"); assert.equal(reopened.config.rows[0].organolepticResult, "poor_quality");
  }
});

test("bulk apply/repeat/delete and paste retain stable row values and localized messages", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const m = (await messages(locale)).perishableRejection;
    const view = fixture(normalizePerishableRejectionConfig({ rows: [{ id: "row-1", productName: "Original", organolepticResult: "compliant", storageCondition: "2_6" }] }));
    await view.render(locale);
    const selectAll = view.find(node => node.props["aria-label"] === m.actions.selectAll); (selectAll.onCheckedChange as (value: boolean) => void)(true); await view.render(locale);
    const apply = view.find(node => typeof node.props.onApply === "function" && Array.isArray(node.props.fields));
    await (apply.onApply as (value: Record<string, string>) => Promise<void>)({ organolepticResult: "non_compliant", storageCondition: "minus2_2" }); await view.render(locale);
    assert.equal(view.config.rows[0].organolepticResult, "non_compliant"); assert.equal(view.config.rows[0].storageCondition, "minus2_2");
    assert.ok(view.successes.at(-1)?.includes("1"));
    const repeat = view.find(node => (node.type as { name?: string })?.name === "SelectionRepeatButton"); (repeat.onClick as () => void)(); await view.render(locale); assert.equal(view.config.rows.length, 2); assert.notEqual(view.config.rows[0].id, view.config.rows[1].id);
    const selection = view.find(node => typeof node.props.onDelete === "function" && node.props.hint === m.actions.selectionHint); (selection.onDelete as () => void)(); await tick(); await view.render(locale); assert.equal(view.config.rows.length, 1); assert.equal(view.confirms.at(-1)?.locale, locale);
    const textArea = view.find(node => node.props.placeholder === m.paste.placeholder); (textArea.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Custom milk\nCustom curd" } }); await view.render(locale);
    view.button(m.actions.add)(); await view.render(locale); assert.equal(view.config.rows.length, 3); assert.equal(view.config.rows[2].productName, "Custom curd");
    await view.flush(); assert.equal(view.requests.at(-1)?.init?.method, "PATCH");
  }
});

test("pending autosave and settings failures use latest language without losing the submitted draft", async () => {
  for (const operation of ["autosave", "settings"] as const) {
    const deferred = Promise.withResolvers<Response>();
    const view = fixture({}, async () => deferred.promise);
    await view.render("en");
    const en = (await messages("en")).perishableRejection;
    if (operation === "autosave") {
      const input = view.find(node => node.props.ariaLabel === en.fields.product); (input.onChange as (value: string) => void)("Pending product"); await view.render("en");
      const button = view.nodes.filter(node => typeof node.props.onClick === "function" && text(node.props.children) === en.actions.addRow).at(-1)!; (button.props.onClick as () => void)(); await view.render("en"); await view.flush();
    } else {
      const input = view.find(node => node.props.value === "Custom title" && typeof node.props.onChange === "function"); (input.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Pending title" } }); await view.render("en");
      const button = view.nodes.filter(node => typeof node.props.onClick === "function" && text(node.props.children) === en.actions.save).at(-1)!; (button.props.onClick as () => void)();
    }
    const before = String(view.requests[0].init?.body);
    await view.render("uz"); deferred.resolve(Response.json({ error: "RAW RUSSIAN FAILURE" }, { status: 500 })); await tick(); await tick();
    assert.deepEqual(view.errors, [(await messages("uz")).perishableRejection.errors[operation === "autosave" ? "save" : "settings"]]);
    assert.equal(String(view.requests[0].init?.body), before);
    assert.ok(before.includes(operation === "autosave" ? "Pending product" : "Pending title"));
  }
});

test("perishable photo intake, directory imports, bulk count validation and expiry presets retain their actual mapping", async () => {
  const item = { name: "Original O‘rik", manufacturer: "Original maker", supplier: "Original seller", quantity: "20 кг", productionDate: "2026-10-14", expiryDate: "2026-10-16" };
  for (const locale of ["ru", "en", "uz"] as const) {
    const all = await messages(locale), m = all.perishableRejection;
    const t = createTranslator({ locale, messages: all, namespace: "perishableRejection" });
    const view = fixture({ productLists: [{ id: "list-original", name: "Original list", items: [] }], rows: [{ id: "original-row", productName: "Before photo", arrivalDate: "2026-10-15", arrivalTime: "23:30", storageCondition: "2_6", organolepticResult: "compliant" }] });
    await view.render(locale);
    const open = view.find(node => typeof node.props.onOpen === "function"); (open.onOpen as () => void)(); await view.render(locale);
    view.button(t("expiry.preset", { hours: 12 }))(); await view.render(locale);
    assert.ok(view.nodes.some(node => node.props.value === "2026-10-16")); assert.ok(view.nodes.some(node => node.props.value === "11:30"));
    const photo = view.find(node => node.props.testId === "perishable-photo");
    const intake = photo.onItems as (items: typeof item[]) => { added: number };
    assert.equal(intake([item]).added, 1); await view.render(locale);
    const row = view.config.rows.at(-1)!; for (const field of ["manufacturer", "supplier", "quantity", "productionDate", "expiryDate"] as const) assert.equal(row[field], item[field]); assert.equal(row.productName, item.name); assert.equal(row.organolepticResult, "compliant");
    const listPhoto = view.find(node => node.props.testId === "perishable-lists-photo"); (listPhoto.onItems as (items: typeof item[]) => unknown)([item]); await view.render(locale);
    assert.equal(view.config.productLists[0].id, "list-original"); assert.ok(view.config.productLists[0].items.includes(item.name)); assert.ok(view.config.manufacturers.includes(item.manufacturer)); assert.ok(view.config.suppliers.includes(item.supplier));
    view.setPromptResult("Custom 3,2%; Original O‘rik\nAnother item"); view.button(m.lists.import)(); await tick(); await view.render(locale);
    assert.deepEqual(Array.from(view.config.productLists[0].items), ["Original O‘rik", "Custom 3,2%", "Another item"]);
    assert.equal(view.prompts.at(-1)?.title, m.import.products); assert.equal(view.prompts.at(-1)?.locale, locale);
    view.setPromptResult("2"); const menu = view.find(node => Array.isArray(node.props.items) && (node.props.items as { key: string }[]).some(item => item.key === "add-several"));
    const action = (menu.items as { key: string; onSelect: () => void }[]).find(item => item.key === "add-several")!; action.onSelect(); await tick(); await view.render(locale);
    const prompt = view.prompts.at(-1)!; const validate = prompt.validate as (value: string) => string | null;
    assert.equal(validate(""), m.bulk.enterNumber); assert.equal(validate("1.5"), m.bulk.positiveInteger); assert.equal(validate("51"), t("bulk.limit", { count: 50 })); assert.equal(validate("2"), null);
    assert.equal(view.config.rows.length, 4); await view.flush();
  }
});

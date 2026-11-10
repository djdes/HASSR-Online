/* eslint-disable react/no-children-prop -- Explicit providers for isolated production-component SSR. */
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
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { validateCatalog } from "@/i18n/catalog-validation";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import type { PrintAgentSettingsClient } from "./print-agent-settings-client";

const require = createRequire(import.meta.url);
const directory = "src/app/(dashboard)/settings/print-agent/";
type Agent = React.ComponentProps<typeof PrintAgentSettingsClient>["agents"][number];
type Node = { type: unknown; props: Record<string, unknown> };
const agent: Agent = { id: "original-device-id", name: "Device O‘tkir", printerName: "Original HP printer", agentVersion: "1.2.3", lastSeenAt: "2026-10-15T08:15:00Z", online: true };

function load<T>(path: string, mocks: Record<string, unknown> = {}, globals: Record<string, unknown> = {}): T {
  const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const fixtureModule = { exports: {} };
  vm.runInNewContext(output, { module: fixtureModule, exports: fixtureModule.exports, Error, TypeError, ...globals, require: (id: string) => Object.hasOwn(mocks, id) ? mocks[id] : require(id) });
  return fixtureModule.exports as T;
}

// Keep the real shared confirmation content; replace only its browser portal host.
const confirm = load<typeof import("@/components/ui/confirm-dialog")>("src/components/ui/confirm-dialog.tsx", {
  "react-dom": { createPortal: (node: React.ReactNode) => node },
}, { document: { body: { matches: () => false } } });

async function render(locale: Locale, children: React.ReactNode, refresh = () => {}) {
  const messages = await loadMessages(locale);
  return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, {
    value: { back() {}, forward() {}, push() {}, replace() {}, prefetch() {}, refresh },
    children: React.createElement(NextIntlClientProvider, { locale, messages: { printAgent: messages.printAgent, journalControls: messages.journalControls }, timeZone: "UTC", onError: error => { throw error; }, children }),
  })).replaceAll("&#x27;", "'");
}

function fixture(fetcher: typeof fetch = async () => { throw new Error("Unexpected request"); }) {
  let cursor = 0, refCursor = 0, refreshes = 0;
  const states: unknown[] = [], refs: { current: unknown }[] = [], effects: (() => void)[] = [], nodes: Node[] = [];
  const successes: string[] = [], errors: string[] = [];
  const wrap = (fn: typeof jsxRuntime.jsx) => (type: unknown, props: Node["props"], key?: string) => { nodes.push({ type, props }); return fn(type as React.ElementType, props, key); };
  const component = load<{ PrintAgentSettingsClient: typeof PrintAgentSettingsClient }>(directory + "print-agent-settings-client.tsx", {
    react: { ...React,
      useRef: (value: unknown) => { const index = refCursor++; return refs[index] ?? (refs[index] = { current: value }); },
      useEffect: (effect: () => void) => { effects.push(effect); },
      useState: (fallback: unknown) => { const index = cursor++; if (index >= states.length) states[index] = typeof fallback === "function" ? fallback() : fallback; return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
    },
    "react/jsx-runtime": { ...jsxRuntime, jsx: wrap(jsxRuntime.jsx), jsxs: wrap(jsxRuntime.jsxs) },
    "@/components/ui/confirm-dialog": confirm,
    sonner: { toast: { success: (value: string) => successes.push(value), error: (value: string) => errors.push(value) } },
  }, { fetch: fetcher });
  return {
    states, nodes, successes, errors, get refreshes() { return refreshes; },
    async render(locale: Locale, agents = [agent], extra: Partial<React.ComponentProps<typeof PrintAgentSettingsClient>> = {}) {
      cursor = 0; refCursor = 0; nodes.length = 0; effects.length = 0;
      const html = await render(locale, React.createElement(component.PrintAgentSettingsClient, { agents, ...extra }), () => { refreshes++; });
      for (const effect of effects) effect();
      return html;
    },
    open() { const button = nodes.find(node => node.type === "button" && node.props["aria-label"]); assert.ok(button); (button.props.onClick as () => void)(); },
    confirmation() { const node = nodes.find(node => node.type === confirm.ConfirmDialog); assert.ok(node); return node.props as { onConfirm: () => Promise<void>; onClose: () => void; open: boolean }; },
  };
}

test("print settings list and real confirmation render all locales, retaining names, URLs and runtime timezone", async () => {
  const baseline = (await loadMessages("ru")).printAgent.settings;
  const initialZone = process.env.TZ;
  try {
    for (const timeZone of ["Asia/Tashkent", "America/New_York"]) {
      process.env.TZ = timeZone;
      for (const locale of ["ru", "en", "uz"] as const) {
        const copy = (await loadMessages(locale)).printAgent.settings;
        assert.deepEqual(validateCatalog(baseline, copy), []);
        const view = fixture();
        const data = [agent, { ...agent, id: "offline", name: "Custom second device", printerName: null, lastSeenAt: null, online: false }];
        const before = JSON.stringify(data);
        const html = await view.render(locale, data);
        for (const expected of [copy.devices.heading, copy.devices.download, copy.devices.online, copy.devices.offline, copy.devices.noPrinter, agent.name, agent.printerName!, new Date(agent.lastSeenAt!).toLocaleString(FORMAT_LOCALES[locale])]) assert.ok(html.includes(expected), `${locale}: ${expected}`);
        assert.ok(html.includes('href="/api/print/agent/download"'));
        view.open();
        const opened = await view.render(locale, data);
        for (const expected of [copy.confirm.description, copy.confirm.queue, copy.confirm.history, (await loadMessages(locale)).journalControls.confirm.cancel]) assert.ok(opened.includes(expected), `${locale}: ${expected}`);
        assert.equal(view.confirmation().open, true);
        view.confirmation().onClose(); assert.equal(view.states[0], null);
        assert.equal(JSON.stringify(data), before);
        assert.ok((await view.render(locale, [])).includes(copy.devices.empty));
      }
    }
  } finally { if (initialZone === undefined) delete process.env.TZ; else process.env.TZ = initialZone; }
});

test("actual revoke handler preserves POST semantics and uses local feedback for success and unknown failures", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const status of [200, 403, 404, 500, "network"] as const) {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const view = fixture(async (url, init) => { requests.push({ url: String(url), init }); if (status === "network") throw new Error("RAW NATIVE FAILURE"); return Response.json({ error: "RAW API FAILURE" }, { status }); });
    await view.render(locale); view.open(); await view.render(locale); await view.confirmation().onConfirm();
    assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ url: "/api/print/agents/original-device-id/revoke", init: { method: "POST" } }]);
    const messages = await loadMessages(locale);
    const copy = messages.printAgent.settings;
    if (status === 200) {
      const t = createTranslator({ locale, messages, namespace: "printAgent.settings" });
      assert.deepEqual(view.successes, [t("devices.disconnected", { name: agent.name })]); assert.equal(view.refreshes, 1);
    } else {
      assert.deepEqual(view.errors, [copy.errors[status === 403 ? "forbidden" : status === 404 ? "notFound" : "failed"]]); assert.equal(view.refreshes, 0);
    }
    assert.deepEqual(view.states, [null, false]);
  }
});

test("pending revoke retains chosen device and shows latest-locale success/error without changing the submitted ID", async () => {
  for (const status of [200, 500]) {
    const deferred = Promise.withResolvers<Response>();
    let submitted = "";
    const view = fixture(async url => { submitted = String(url); return deferred.promise; });
    await view.render("ru"); view.open(); await view.render("en");
    const pending = view.confirmation().onConfirm();
    const html = await view.render("uz");
    const messages = await loadMessages("uz");
    assert.ok(html.includes(messages.printAgent.settings.devices.disconnecting));
    assert.deepEqual(view.states, [agent, true]); view.confirmation().onClose(); assert.equal(view.states[0], agent);
    deferred.resolve(Response.json({ error: "RAW" }, { status })); await pending;
    assert.equal(submitted, "/api/print/agents/original-device-id/revoke");
    const t = createTranslator({ locale: "uz", messages, namespace: "printAgent.settings" });
    assert.deepEqual(status === 200 ? view.successes : view.errors, [status === 200 ? t("devices.disconnected", { name: agent.name }) : t("errors.failed")]);
  }
});

test("actual settings page keeps management/tenant guards and renders localized instructions with literal installer and command", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    let allowed = true, queries = 0;
    const page = load<{ default: () => Promise<React.ReactNode> }>(directory + "page.tsx", {
      "next-intl/server": {
        getTranslations: async (namespace: string) => createTranslator({ locale, messages, namespace: namespace as "printAgent.settings.page" }),
        getLocale: async () => locale,
      },
      "@/lib/auth-helpers": { requireAuth: async () => ({ user: { id: "manager", organizationId: "original-org" } }), getActiveOrgId: () => "active-org" },
      "@/lib/role-access": { hasFullWorkspaceAccess: () => allowed },
      // Точки выключены — выбора точки у принтера нет (2026-11-01).
      "@/lib/active-building": { loadBuildingContext: async () => ({ enabled: false, buildings: [] }) },
      "next/navigation": { redirect: (url: string) => { throw new Error(`Redirect ${url}`); }, forbidden: () => { throw new Error("Forbidden"); } },
      "@/lib/db": { db: {
        printAgent: { findMany: async ({ where }: { where: unknown }) => { assert.equal(JSON.stringify(where), JSON.stringify({ organizationId: "active-org", revokedAt: null })); queries++; return [{ ...agent, lastSeenAt: new Date(agent.lastSeenAt!) }]; } },
        // Принтеры этикеток и телефоны «Сетап помощника» — тоже только активной организации.
        labelPrinter: { findMany: async ({ where }: { where: unknown }) => { assert.equal(JSON.stringify(where), JSON.stringify({ organizationId: "active-org", removedAt: null })); return []; } },
        setupHelperDevice: { findMany: async ({ where }: { where: unknown }) => { assert.equal(JSON.stringify(where), JSON.stringify({ organizationId: "active-org", revokedAt: null })); return []; } },
        user: { findMany: async () => { throw new Error("No helper users to look up"); } },
        organization: { findUnique: async ({ where }: { where: { id: string } }) => { assert.equal(where.id, "active-org"); return { timezone: "Asia/Tashkent" }; } },
        // Сводка журнала маркировки — тоже только активной организации.
        labelPrint: {
          aggregate: async ({ where }: { where: { organizationId: string } }) => { assert.equal(where.organizationId, "active-org"); return { _count: { _all: 3 }, _sum: { copies: 5 } }; },
          count: async ({ where }: { where: { organizationId: string } }) => { assert.equal(where.organizationId, "active-org"); return 1; },
        },
      } },
      "@/components/i18n/domain-messages-boundary": { DomainMessagesBoundary: ({ namespaces, children }: { namespaces: string[]; children: React.ReactNode }) => { assert.deepEqual(Array.from(namespaces), ["printAgent", "journalControls"]); return children; } },
      // Версия APK на сайте: страница показывает её у кнопки скачивания.
      "@/lib/setup-helper-release": { readSetupHelperRelease: async () => ({ versionCode: 2, versionName: "1.1.0", sha256: "a".repeat(64), size: 2_000_000 }) },
    });
    const html = await render(locale, await page.default());
    for (const expected of [messages.printAgent.settings.page.title, messages.printAgent.settings.page.how, "Установить.bat", "Win+R → netplwiz", agent.name]) assert.ok(html.includes(expected));
    for (const expected of [messages.printAgent.labelPrinters.heading, messages.printAgent.labelPrinters.download, messages.printAgent.labelPrinters.printers.empty, messages.printAgent.labelPrinters.devices.empty]) assert.ok(html.includes(expected), `${locale}: ${expected}`);
    assert.ok(html.includes('href="/api/setup-helper/download"'));
    const labelsT = createTranslator({ locale, messages, namespace: "printAgent.labelPrinters" });
    assert.ok(html.includes(labelsT("version", { version: "1.1.0" })), `${locale}: версия приложения`);
    assert.ok(html.includes(messages.printAgent.labelPrinters.autoUpdate.slice(0, 40)), `${locale}: про автообновление`);
    const logT = createTranslator({ locale, messages, namespace: "printAgent.labelLog" });
    assert.ok(html.includes(logT("summary.heading")), `${locale}: сводка маркировки`);
    assert.ok(html.includes(logT("summary.todayValue", { labels: logT("labels", { count: 3 }), copies: logT("copies", { count: 5 }) })), `${locale}: напечатано сегодня`);
    assert.ok(html.includes('href="/settings/print-agent/labels"'), `${locale}: ссылка на журнал маркировки`);
    assert.equal(queries, 1);
    allowed = false; await assert.rejects(page.default, /Forbidden/); assert.equal(queries, 1);
  }
});

test("принтер своей точки: выбор точки в строке принтера отправляет PATCH, руководителю точки нет «Вся организация»", async () => {
  const requests: { url: string; method?: string; body?: unknown }[] = [];
  const view = fixture(async (url, init) => { requests.push({ url: String(url), method: init?.method, body: init?.body }); return Response.json({ ok: true }); });
  const points = [{ id: "point-a", name: "Точка А" }, { id: "point-b", name: "Точка Б" }];
  const messages = await loadMessages("ru");
  const copy = messages.printAgent.settings;
  const html = await view.render("ru", [{ ...agent, buildingId: "point-a", buildingName: "Точка А" }], { points });
  for (const expected of [copy.devices.point, `<option value="">${copy.devices.allPoints}</option>`, copy.devices.pointHint, "Точка Б"]) assert.ok(html.includes(expected), expected);
  const select = view.nodes.find(node => node.type === "select");
  assert.ok(select);
  assert.equal(select.props.value, "point-a");
  (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "point-b" } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(requests, [{ url: "/api/print/agents/original-device-id", method: "PATCH", body: JSON.stringify({ buildingId: "point-b" }) }]);
  const t = createTranslator({ locale: "ru", messages, namespace: "printAgent.settings" });
  assert.deepEqual(view.successes, [t("devices.pointChanged", { name: agent.name, point: "Точка Б" })]);
  assert.equal(view.refreshes, 1);
  assert.deepEqual(view.states, [null, false], "смена точки не трогает состояние отключения");
  const scoped = await view.render("ru", [{ ...agent, buildingId: "point-a" }], { points: [points[0]], canChooseOrganization: false });
  assert.ok(!scoped.includes('<option value="">'), "руководитель точки не делает принтер общим");
  const withoutPoints = await view.render("ru", [{ ...agent, buildingId: "point-a", buildingName: "Точка А" }]);
  assert.ok(!withoutPoints.includes(copy.devices.pointHint), "без журналов по точкам — без выбора");
  assert.ok(withoutPoints.includes("Точка А"), "точка видна подписью");
});

test("страница принтера: руководитель точки видит только принтеры своих точек и свои точки в выборе", async () => {
  const messages = await loadMessages("ru");
  const agents = [
    { ...agent, id: "agent-a", name: "Касса точки А", buildingId: "point-a", building: { name: "Точка А" }, lastSeenAt: new Date(agent.lastSeenAt!) },
    { ...agent, id: "agent-b", name: "Касса точки Б", buildingId: "point-b", building: { name: "Точка Б" }, lastSeenAt: new Date(agent.lastSeenAt!) },
    { ...agent, id: "agent-org", name: "Общий офисный", buildingId: null, building: null, lastSeenAt: new Date(agent.lastSeenAt!) },
  ];
  const page = load<{ default: () => Promise<React.ReactNode> }>(directory + "page.tsx", {
    "next-intl/server": {
      getTranslations: async (namespace: string) => createTranslator({ locale: "ru", messages, namespace: namespace as "printAgent.settings.page" }),
      getLocale: async () => "ru",
    },
    "@/lib/auth-helpers": { requireAuth: async () => ({ user: { id: "point-manager", organizationId: "org", pointScope: ["point-a"] } }), getActiveOrgId: () => "org" },
    "@/lib/role-access": { hasFullWorkspaceAccess: () => true },
    "@/lib/active-building": {
      loadBuildingContext: async () => ({ enabled: true, buildings: [{ id: "point-a", name: "Точка А" }, { id: "point-b", name: "Точка Б" }] }),
    },
    "next/navigation": { redirect: (url: string) => { throw new Error(`Redirect ${url}`); }, forbidden: () => { throw new Error("Forbidden"); } },
    "@/lib/db": { db: {
      printAgent: { findMany: async () => agents },
      labelPrinter: { findMany: async () => [] },
      setupHelperDevice: { findMany: async () => [] },
      user: { findMany: async () => [] },
      organization: { findUnique: async () => ({ timezone: "Europe/Moscow" }) },
      labelPrint: { aggregate: async () => ({ _count: { _all: 0 }, _sum: { copies: 0 } }), count: async () => 0 },
    } },
    "@/components/i18n/domain-messages-boundary": { DomainMessagesBoundary: ({ children }: { children: React.ReactNode }) => children },
    "@/lib/setup-helper-release": { readSetupHelperRelease: async () => null },
  });
  const html = await render("ru", await page.default());
  assert.ok(html.includes("Касса точки А"));
  assert.ok(!html.includes("Касса точки Б"), "принтер чужой точки не виден");
  assert.ok(!html.includes("Общий офисный"), "общий принтер ведёт руководство компании");
  assert.ok(html.includes('value="point-a"'));
  assert.ok(!html.includes('value="point-b"'), "чужая точка не предлагается");
  assert.ok(!html.includes('<option value="">'), "«Вся организация» руководителю точки не предлагается");
});

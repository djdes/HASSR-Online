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
import { formatDate, type Locale } from "@/i18n/locales";
import type { HelperDeviceView, LabelPrinterView, LabelPrintersClient } from "./label-printers-client";

const require = createRequire(import.meta.url);
const directory = "src/app/(dashboard)/settings/print-agent/";
type Node = { type: unknown; props: Record<string, unknown> };

const printer: LabelPrinterView = {
  id: "printer-1",
  name: "IP-802BT",
  model: "AIYIN IP-802BT",
  address: "DC:0D:30:12:34:56",
  transport: "classic",
  connectedAt: "2026-10-25T07:30:00Z",
  deviceName: "Samsung SM-A515F",
  connectedBy: "Иван O‘tkir",
  lastPrintAt: "2026-10-25T07:35:00Z",
  lastTemplate: "test-58x40",
};
const device: HelperDeviceView = {
  id: "device-1",
  name: "Samsung SM-A515F",
  userName: "Иван O‘tkir",
  appVersion: "1.0.0",
  lastSeenAt: "2026-10-25T07:36:00Z",
};

function load<T>(path: string, mocks: Record<string, unknown> = {}, globals: Record<string, unknown> = {}): T {
  const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const fixtureModule = { exports: {} };
  vm.runInNewContext(output, { module: fixtureModule, exports: fixtureModule.exports, Error, TypeError, Object, ...globals, require: (id: string) => Object.hasOwn(mocks, id) ? mocks[id] : require(id) });
  return fixtureModule.exports as T;
}

// Настоящий диалог подтверждения; подменяем только портал браузера.
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
  const component = load<{ LabelPrintersClient: typeof LabelPrintersClient }>(directory + "label-printers-client.tsx", {
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
    states, successes, errors, get refreshes() { return refreshes; },
    async render(locale: Locale, printers = [printer], devices = [device], timeZone = "Asia/Tashkent", latestVersion: string | null = null) {
      cursor = 0; refCursor = 0; nodes.length = 0; effects.length = 0;
      const html = await render(locale, React.createElement(component.LabelPrintersClient, { printers, devices, timeZone, latestVersion }), () => { refreshes++; });
      for (const effect of effects) effect();
      return html;
    },
    open() { const button = nodes.find(node => node.type === "button" && node.props["aria-label"]); assert.ok(button); (button.props.onClick as () => void)(); },
    confirmation() { const node = nodes.find(node => node.type === confirm.ConfirmDialog); assert.ok(node); return node.props as { onConfirm: () => Promise<void>; onClose: () => void; open: boolean }; },
  };
}

test("label printers catalog is complete in every locale", async () => {
  const baseline = (await loadMessages("ru")).printAgent.labelPrinters;
  for (const locale of ["en", "uz"] as const) {
    assert.deepEqual(validateCatalog(baseline, (await loadMessages(locale)).printAgent.labelPrinters), []);
  }
});

test("connected printers and phones render in all locales with the data the phone reported", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const copy = messages.printAgent.labelPrinters;
    const t = createTranslator({ locale, messages, namespace: "printAgent.labelPrinters" });
    const when = (iso: string) => formatDate(locale, new Date(iso), "Asia/Tashkent", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const view = fixture();
    const unknown = { ...printer, id: "printer-2", name: "BLE-PRINTER", model: null, transport: "ble", deviceName: null, connectedBy: null, lastPrintAt: "2026-10-25T08:00:00Z", lastTemplate: "custom-code" };
    const silent = { ...device, id: "device-2", name: "Pixel 8", userName: null, appVersion: null, lastSeenAt: null };
    const html = await view.render(locale, [printer, unknown], [device, silent]);
    for (const expected of [
      copy.printers.heading, copy.devices.heading, copy.devices.description,
      printer.name, printer.model!, printer.address, copy.printers.transport.classic, copy.printers.transport.ble,
      t("printers.connectedVia", { when: when(printer.connectedAt), device: printer.deviceName! }),
      printer.connectedBy!,
      t("printers.lastPrint", { when: when(printer.lastPrintAt!), template: copy.templates.test58x40 }),
      t("printers.connected", { when: when(unknown.connectedAt) }),
      // Неизвестный приложению сайта шаблон показываем кодом, а не пустотой.
      t("printers.lastPrint", { when: when(unknown.lastPrintAt), template: "custom-code" }),
      t("devices.lastSeen", { user: device.userName!, when: when(device.lastSeenAt!) }),
      t("devices.version", { version: "1.0.0" }),
      t("devices.neverSeen", { user: copy.devices.unknownUser }),
      t("devices.disconnectAria", { name: device.name }),
    ]) assert.ok(html.includes(expected), `${locale}: ${expected}`);
    if (locale !== "ru") {
      // Кириллица на чужом языке — только в данных (имя сотрудника), не в подписях.
      assert.doesNotMatch(html.replaceAll(printer.connectedBy!, ""), /[А-Яа-яЁё]/);
    }

    // Пояс организации, а не процесса: разметка сервера и браузера совпадает (без ошибки гидрации).
    const initialZone = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      assert.equal(await view.render(locale, [printer, unknown], [device, silent]), html);
    } finally {
      if (initialZone === undefined) delete process.env.TZ; else process.env.TZ = initialZone;
    }
    // 07:30 UTC в Ташкенте (UTC+5) — 12:30, независимо от пояса процесса.
    assert.ok(html.includes("12:30"), `${locale}: время в поясе организации`);

    const empty = await view.render(locale, [], []);
    assert.ok(empty.includes(copy.printers.empty));
    assert.ok(empty.includes(copy.devices.empty));
  }
});

test("phones behind the published version are marked and production templates are named", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const copy = messages.printAgent.labelPrinters;
    const t = createTranslator({ locale, messages, namespace: "printAgent.labelPrinters" });
    const view = fixture();
    const outdated = { ...device, outdated: true };
    const current = { ...device, id: "device-2", name: "Pixel 8", appVersion: "1.1.0", outdated: false };
    const sampled = { ...printer, lastTemplate: "daily-sample" };
    const html = await view.render(locale, [sampled], [outdated, current], "Asia/Tashkent", "1.1.0");
    const pending = t("devices.updatePending", { version: "1.1.0" });
    assert.equal(html.split(pending).length - 1, 1, `${locale}: помечен только телефон со старой версией`);
    assert.ok(html.includes(copy.templates.dailySample), `${locale}: шаблон производства назван по-человечески`);
    // Версии на сайте нет — и пометки нет.
    assert.ok(!(await view.render(locale, [sampled], [outdated], "Asia/Tashkent", null)).includes(pending));
  }
});

test("revoking a phone posts to its own endpoint, confirms first and reports the outcome locally", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const status of [200, 403, 404, 500, "network"] as const) {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const view = fixture(async (url, init) => { requests.push({ url: String(url), init }); if (status === "network") throw new Error("RAW NATIVE FAILURE"); return Response.json({ error: "RAW API FAILURE" }, { status }); });
    await view.render(locale);
    view.open();
    const opened = await view.render(locale);
    const messages = await loadMessages(locale);
    const copy = messages.printAgent.labelPrinters;
    for (const expected of [copy.confirm.description, copy.confirm.offline, copy.confirm.printers]) assert.ok(opened.includes(expected), `${locale}: ${expected}`);
    assert.equal(view.confirmation().open, true);
    await view.confirmation().onConfirm();
    assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ url: "/api/setup-helper/devices/device-1/revoke", init: { method: "POST" } }]);
    if (status === 200) {
      const t = createTranslator({ locale, messages, namespace: "printAgent.labelPrinters" });
      assert.deepEqual(view.successes, [t("devices.disconnected", { name: device.name })]);
      assert.equal(view.refreshes, 1);
    } else {
      assert.deepEqual(view.errors, [copy.errors[status === 403 ? "forbidden" : status === 404 ? "notFound" : "failed"]]);
      assert.equal(view.refreshes, 0);
    }
    assert.deepEqual(view.states, [null, false]);
  }
});

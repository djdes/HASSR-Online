/* eslint-disable react/no-children-prop -- Isolated production component fixture. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import type { YandexBackupClient } from "./yandex-backup-client";

const require = createRequire(import.meta.url);
type NodeProps = { children?: React.ReactNode; type?: string; onClick?: () => Promise<void> | void; onChange?: (event: { target: { value: string } }) => void; onConfirm?: () => Promise<void>; [key: string]: unknown };
function descendants(node: React.ReactNode): React.ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement<NodeProps>(node)) return [];
  return [node, ...descendants(node.props.children)];
}
function fixture(fetcher: typeof fetch, connected: boolean) {
  const states: unknown[] = [], refs: { current: unknown }[] = [], effects: (() => void)[] = [];
  let stateIndex = 0, refIndex = 0, tree: React.ReactNode, refreshes = 0;
  const success: string[] = [], errors: string[] = [];
  const fixtureModule = { exports: {} as { YandexBackupClient: typeof YandexBackupClient } };
  const source = ts.transpileModule(readFileSync("src/app/(dashboard)/settings/backup/yandex-backup-client.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  function Confirm(props: NodeProps) { return props.open ? React.createElement("div", null, String(props.title), String(props.description), JSON.stringify(props.bullets)) : null; }
  vm.runInNewContext(source, {
    module: fixtureModule, exports: fixtureModule.exports, fetch: fetcher, Date,
    require: (id: string) => {
      if (id === "react") return { ...React,
        useState: (initial: unknown) => { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
        useRef: (initial: unknown) => { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }); },
        useEffect: (callback: () => void) => effects.push(callback),
      };
      if (id === "next/navigation") return { useRouter: () => ({ refresh() { refreshes++; } }) };
      if (id === "sonner") return { toast: { success: (value: string) => success.push(value), error: (value: string) => errors.push(value) } };
      if (id === "@/components/ui/confirm-dialog") return { ConfirmDialog: Confirm };
      return require(id);
    },
  });
  function Probe() { tree = fixtureModule.exports.YandexBackupClient({ initialState: { connected, folder: "/Original O‘rik", lastBackupAt: null }, recentLogs: [
    { id: "ok", action: "yandex_backup.manual", createdAt: "2026-10-15T12:00:00Z", details: { path: "/Original/history.json", sizeBytes: 2048 } },
    { id: "error", action: "yandex_backup.error", createdAt: "2026-10-14T12:00:00Z", details: { error: "Provider original diagnostic" } },
  ] }); return tree; }
  return { success, errors, states, get refreshes() { return refreshes; },
    nodes() { return descendants(tree); },
    async render(locale: Locale) {
      stateIndex = 0; refIndex = 0;
      const html = renderToStaticMarkup(React.createElement(NextIntlClientProvider, { locale, timeZone: "UTC", messages: { yandexBackup: (await loadMessages(locale)).yandexBackup }, onError: error => { throw error; }, children: React.createElement(Probe) }));
      effects.splice(0).forEach(effect => effect());
      return html;
    },
  };
}

test("Yandex settings render all states, preserve drafts/history and retain endpoint in RU EN UZ", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const connected of [false, true]) {
    const view = fixture(async () => { throw new Error("Unexpected external call"); }, connected);
    const html = await view.render(locale);
    const copy = (await loadMessages(locale)).yandexBackup;
    assert.ok(html.includes(connected ? copy.connected : copy.connectTitle));
    assert.ok(html.includes(copy.history));
    assert.ok(html.includes("Provider original diagnostic"));
    assert.ok(html.includes("/Original/history.json"));
    if (!connected) {
      assert.ok(html.includes("https://oauth.yandex.ru/authorize?response_type=token"));
      view.nodes().find(node => node.type === "input" && node.props.type === "password")!.props.onChange!({ target: { value: "original-token-123" } });
      view.nodes().find(node => node.type === "input" && node.props.type === "text")!.props.onChange!({ target: { value: "/Customer folder" } });
      await view.render(locale === "uz" ? "en" : "uz");
      assert.equal(view.nodes().find(node => node.props.type === "password")!.props.value, "original-token-123");
      assert.equal(view.nodes().find(node => node.props.type === "text")!.props.value, "/Customer folder");
    } else {
      const buttons = view.nodes().filter(node => node.type === "button");
      await buttons[1].props.onClick!();
      assert.ok((await view.render(locale)).includes(copy.confirmTitle));
    }
  }
});

test("Yandex connect/disconnect/run retain payloads and use latest locale after fetch and body", async () => {
  for (const action of ["connect", "disconnect", "run"] as const) for (const outcome of ["success", "server", "network"] as const) {
    const response = Promise.withResolvers<Response>(), body = Promise.withResolvers<unknown>();
    const calls: { url: string; init?: RequestInit }[] = [];
    const view = fixture(async (url, init) => { calls.push({ url: String(url), init }); return response.promise; }, action !== "connect");
    await view.render("ru");
    if (action === "connect") {
      view.nodes().find(node => node.props.type === "password")!.props.onChange!({ target: { value: "  original-token-123  " } });
      await view.render("ru");
    }
    const buttons = view.nodes().filter(node => node.type === "button");
    let pending: Promise<void> | void;
    if (action === "disconnect") {
      await buttons[1].props.onClick!(); await view.render("ru");
      pending = view.nodes().find(node => node.props.onConfirm)!.props.onConfirm!();
    } else pending = buttons[0].props.onClick!();
    await view.render("en");
    if (outcome === "network") response.reject(new Error("Raw secret diagnostic"));
    else {
      response.resolve({ ok: outcome === "success", json: () => body.promise } as Response);
      await Promise.resolve(); await Promise.resolve();
    }
    await view.render("uz");
    body.resolve({ userLogin: "Original-login", path: "/Original/backup.json", sizeBytes: 2048, errorCode: "YANDEX_BACKUP_FORBIDDEN", error: "Raw server text" });
    await pending;
    const t = createTranslator({ locale: "uz", messages: await loadMessages("uz"), namespace: "yandexBackup" });
    assert.equal(calls[0].init?.method, action === "connect" ? "PUT" : action === "disconnect" ? "DELETE" : "POST");
    assert.equal(calls[0].url, `/api/settings/yandex-backup${action === "run" ? "/run" : ""}`);
    if (action === "connect") assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { token: "original-token-123", folder: "/Original O‘rik" });
    if (outcome === "success") {
      // DELETE has no response body; its feedback is issued in the language at fetch completion.
      const expected = action === "connect" ? t("connectedUser", { login: "Original-login" }) : action === "run" ? t("uploadedFile", { path: "/Original/backup.json", size: 2 }) : (await loadMessages("en")).yandexBackup.disconnected;
      assert.deepEqual(view.success, [expected]); assert.equal(view.refreshes, 1);
    } else {
      const currentCopy = (await loadMessages(outcome === "network" ? "en" : "uz")).yandexBackup;
      assert.deepEqual(view.errors, [outcome === "server" ? currentCopy.forbidden : action === "connect" ? currentCopy.connectError : action === "run" ? currentCopy.backupError : currentCopy.disconnectError]);
      assert.equal(view.refreshes, 0);
    }
  }
});

/* eslint-disable react/no-children-prop -- Explicit children in isolated provider fixture. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import { FORMAT_LOCALES } from "@/i18n/locales";

const require = createRequire(import.meta.url);
function fixture(initial: unknown[], fetcher?: typeof fetch) {
  const state = [...initial];
  const effects: (() => void | (() => void))[] = [];
  const timers: { callback: () => Promise<void>; delay: number }[] = [];
  const cleared: unknown[] = [];
  let cursor = 0;
  const fixtureModule = { exports: {} as { PrintAgentCard: React.ElementType } };
  const output = ts.transpileModule(readFileSync("src/components/dashboard/print-agent-card.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(output, {
    module: fixtureModule, exports: fixtureModule.exports, fetch: fetcher, Date,
    setInterval: (callback: () => Promise<void>, delay: number) => { timers.push({ callback, delay }); return 123; },
    clearInterval: (id: unknown) => { cleared.push(id); },
    require: (id: string) => {
      if (id === "react") return { ...React, useState: (fallback: unknown) => {
        const index = cursor++;
        if (index >= state.length) state[index] = fallback;
        return [state[index], (value: unknown) => { state[index] = value; }];
      }, useEffect: (callback: () => void | (() => void), deps: unknown[]) => { assert.equal(deps.length, 0); effects.push(callback); } };
      if (id === "@/components/ui/link-pending") return { LinkPendingSpinner: () => null };
      return require(id);
    },
  });
  return { Component: fixtureModule.exports.PrintAgentCard, state, effects, timers, cleared, reset: () => { cursor = 0; } };
}

test("print card states/statuses/dates use narrow RU/EN/UZ provider and preserve device/document/error text", async () => {
  const statuses = ["pending", "printing", "done", "error", "cancelled"] as const;
  const jobs = statuses.map((status, index) => ({ id: String(index), docTitle: `Мой журнал ${index}`, status, errorMsg: "Native printer output", createdAt: "2026-10-15T10:11:00Z", createdByName: "Моё имя" }));
  const agent = { id: "agent", name: "Мой компьютер", printerName: "Мой принтер", lastSeenAt: "2026-10-15T10:11:00Z", online: true };
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const copy = messages.printAgent.card;
    for (const agents of [null, [], [agent], [{ ...agent, online: false, lastSeenAt: null }]]) {
      const view = fixture([agents, jobs]);
      const html = renderToStaticMarkup(React.createElement(NextIntlClientProvider, {
        locale, messages: { printAgent: messages.printAgent }, timeZone: "Europe/Moscow", onError: error => { throw error; },
        children: React.createElement(view.Component),
      }));
      for (const status of statuses) assert.ok(html.includes(copy.status[status]));
      assert.ok(html.includes("Мой журнал 0"));
      assert.ok(html.includes('title="Native printer output"'));
      assert.ok(html.includes(copy.history));
      assert.ok(html.includes('href="/settings/print-agent"'));
      if (!agents?.length) assert.ok(html.includes(copy.disconnected));
      else {
        assert.ok(html.includes(agent.name));
        assert.ok(html.includes(agent.printerName));
        if (agents[0].online) assert.ok(html.includes(new Date(agent.lastSeenAt).toLocaleString(FORMAT_LOCALES[locale])));
        else { assert.ok(html.includes(copy.offline)); assert.ok(html.includes(copy.neverSeen)); }
      }
      assert.equal(view.state[0], agents);
      assert.equal(view.state[1], jobs);
    }
  }
});

test("actual print polling retains data on failure and ignores late response after cleanup", async () => {
  const requests: string[] = [];
  const response = Promise.withResolvers<Response>();
  let success = true;
  const view = fixture([[], []], async url => {
    requests.push(String(url));
    if (requests.length === 1) return response.promise;
    return success ? Response.json({ agents: [{ id: "existing" }], jobs: [{ id: "job" }] }) : new Response(null, { status: 500 });
  });
  const messages = await loadMessages("en");
  renderToStaticMarkup(React.createElement(NextIntlClientProvider, { locale: "en", timeZone: "Europe/Moscow", messages: { printAgent: messages.printAgent }, children: React.createElement(view.Component) }));
  const cleanup = view.effects[0]();
  assert.equal(view.timers[0].delay, 20_000);
  await view.timers[0].callback();
  const loaded = structuredClone(view.state);
  success = false;
  await view.timers[0].callback();
  assert.deepEqual(view.state, loaded);
  assert.ok(typeof cleanup === "function");
  cleanup();
  response.resolve(Response.json({ agents: [{ id: "late" }], jobs: [] }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(view.state, loaded);
  assert.deepEqual(view.cleared, [123]);
  assert.ok(requests.every(url => url === "/api/print/status"));
});

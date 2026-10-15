/* eslint-disable react/no-children-prop -- Isolated SSR hook fixture. */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import type { useJournalDocumentActions } from "./use-journal-document-actions";

const require = createRequire(import.meta.url);
function fixture(fetcher: typeof fetch) {
  const refs: { current: unknown }[] = [];
  let refIndex = 0;
  const effects: (() => void)[] = [];
  const successes: string[] = [], errors: string[] = [];
  let actions!: ReturnType<typeof useJournalDocumentActions>;
  const fixtureModule = { exports: {} as { useJournalDocumentActions: typeof useJournalDocumentActions } };
  const code = ts.transpileModule(readFileSync("src/components/journals/use-journal-document-actions.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, {
    module: fixtureModule, exports: fixtureModule.exports, fetch: fetcher,
    require: (id: string) => {
      if (id === "react") return { ...React, useRef: (value: unknown) => { const index = refIndex++; return refs[index] ?? (refs[index] = { current: value }); }, useEffect: (callback: () => void) => effects.push(callback) };
      if (id === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
      if (id === "sonner") return { toast: { success: (value: string) => successes.push(value), error: (value: string) => errors.push(value) } };
      if (id === "./export-language-choice") return { useExportLanguageChoice: () => () => {} };
      if (id === "@/components/ui/confirm-async") return { confirmAsync: async () => true };
      return require(id);
    },
  });
  function Probe() { actions = fixtureModule.exports.useJournalDocumentActions("original-id"); return null; }
  return {
    successes, errors, get actions() { return actions; },
    async render(locale: Locale) {
      refIndex = 0;
      renderToStaticMarkup(React.createElement(NextIntlClientProvider, { locale, timeZone: "UTC", messages: { journalControls: (await loadMessages(locale)).journalControls }, children: React.createElement(Probe) }));
      for (const effect of effects.splice(0)) effect();
    },
  };
}

test("document delete/close/reopen feedback follows locale after delayed requests without changing mutation payloads", async () => {
  for (const action of ["delete", "closed", "active"] as const) for (const outcome of ["success", "server", "network"] as const) {
    const response = Promise.withResolvers<Response>();
    const requests: { url: string; init?: RequestInit }[] = [];
    const view = fixture(async (url, init) => { requests.push({ url: String(url), init }); return response.promise; });
    await view.render("en");
    const pending = action === "delete" ? view.actions.deleteDocument({ skipConfirm: true }) : view.actions.setStatus(action);
    await view.render("uz");
    if (outcome === "network") response.reject(new Error("Raw exception"));
    else response.resolve(Response.json({ error: "English response" }, { status: outcome === "success" ? 200 : 400, headers: { "Content-Language": "en" } }));
    assert.equal(await pending, outcome === "success");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/journal-documents/original-id");
    assert.equal(requests[0].init?.method, action === "delete" ? "DELETE" : "PATCH");
    if (action !== "delete") assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { status: action });
    const copy = (await loadMessages("uz")).journalControls.documentActions;
    if (outcome === "success") assert.deepEqual(view.successes, [action === "delete" ? copy.deleted : action === "closed" ? copy.closed : copy.reopened]);
    else assert.deepEqual(view.errors, [outcome === "network" ? action === "delete" ? copy.deleteNetworkError : copy.statusNetworkError : action === "delete" ? copy.deleteError : action === "closed" ? copy.closeError : copy.reopenError]);
  }
});

test("explicit custom success text and submitted document override remain original", async () => {
  const response = Promise.withResolvers<Response>();
  let requested = "";
  const view = fixture(async url => { requested = String(url); return response.promise; });
  await view.render("ru");
  let called = 0;
  const pending = view.actions.deleteDocument({ documentId: "override-id", successMessage: "Custom authored feedback", onSuccess: () => { called++; } });
  await view.render("uz");
  response.resolve(Response.json({ ok: true }));
  await pending;
  assert.equal(requested, "/api/journal-documents/override-id");
  assert.deepEqual(view.successes, ["Custom authored feedback"]);
  assert.equal(called, 1);
});

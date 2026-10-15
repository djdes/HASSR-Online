/* eslint-disable react/no-children-prop -- Explicit provider children for SSR tests. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { loadMessages } from "@/i18n/messages";
import { MobileViewToggle } from "./mobile-view-toggle";
import { JournalTabs, EmptyDocumentsState, DocumentActionsMenu } from "./document-list-ui";
import { JournalQrPointButton } from "./journal-list-actions";
import { FillGuideLauncher } from "./fill-guide-launcher";
import { JournalDocGuideBody } from "./journal-doc-guide-body";

const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };

test("journal shared controls render translated visible and accessible copy using runtime namespaces", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const controls = [
      createElement(MobileViewToggle, { mobileView: "cards", onChange() {} }),
      createElement(MobileViewToggle, { mobileView: "table", onChange() {} }),
      createElement(JournalTabs, { activeTab: "closed", templateCode: "cleaning" }),
      createElement<NonNullable<Parameters<typeof EmptyDocumentsState>[0]>>(EmptyDocumentsState, { canManage: false }),
      createElement(DocumentActionsMenu, { onPrint() {}, onDelete() {}, document: { id: "saved-id", title: "O‘tkir", status: "closed" } }),
      createElement(JournalQrPointButton, { templateCode: "cleaning" }),
      createElement(FillGuideLauncher, { code: "cleaning", page: "list", variant: "button" }),
    ];
    for (const control of controls) {
      const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, {
        value: router,
        children: createElement(NextIntlClientProvider, {
          locale, messages: { journalControls: messages.journalControls, journals: messages.journals, journalDocGuides: messages.journalDocGuides }, timeZone: "Europe/Moscow",
          onError: error => { throw error; }, children: control,
        }),
      }));
      assert.ok(html.length > 0);
      if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u, locale);
      if (control.type === FillGuideLauncher) assert.ok(html.includes(messages.journalControls.list.guide), "guide trigger must not be blank");
      if (control.type === MobileViewToggle) assert.match(html, /aria-selected="true"/);
      if (control.type === JournalTabs) assert.match(html, /href="\/journals\/cleaning\?tab=closed"/);
    }
  }
});

test("custom mobile view captions are preserved across locales", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, messages: { journalControls: messages.journalControls }, timeZone: "Europe/Moscow",
      onError: error => { throw error; },
      children: createElement(MobileViewToggle, {
        mobileView: "cards", onChange() {}, cardsLabel: "Мои карточки", tableLabel: "Custom O‘tkir",
      }),
    }));
    assert.ok(html.includes("Мои карточки"));
    assert.ok(html.includes("Custom O‘tkir"));
  }
});

test("open guide dialog translates portal chrome while preserving supplied step content", async () => {
  // SSR cannot mount a DOM portal. Replace only its target adapter, retaining the
  // actual production component, React hooks, and selected message provider.
  const code = ts.transpileModule(readFileSync("src/components/journals/fill-guide-dialog.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const fixtureModule = { exports: {} };
  const require = createRequire(import.meta.url);
  vm.runInNewContext(code, {
    module: fixtureModule, exports: fixtureModule.exports, document: { body: {} },
    require: (id: string) => id === "react-dom" ? { createPortal: (child: unknown) => child } : require(id),
  });
  const { FillGuideDialog } = fixtureModule.exports as typeof import("./fill-guide-dialog");
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, messages: { journalControls: messages.journalControls, journalFillingGuides: messages.journalFillingGuides }, timeZone: "Europe/Moscow", onError: error => { throw error; },
      children: createElement(FillGuideDialog, {
        open: true, onClose() {}, journalName: "Custom O‘tkir", page: "list", guide: null,
        journalCode: "cleaning", guideHref: "/journals/cleaning/guide", tourAvailable: true,
        onShowStep() {}, showStepHint: () => null, onStartTour() {},
        steps: [{ id: "settings", page: "document", title: "Original title", body: "Original body", forManager: true }],
      }),
    }));
    assert.match(html, /role="dialog"/);
    assert.ok(html.includes("Custom O‘tkir"));
    assert.ok(html.includes("Original title") && html.includes("Original body"));
    assert.ok(html.includes(messages.journalControls.guide.manager));
    assert.ok(html.includes(messages.journalControls.guide.document));
    assert.ok(html.includes(messages.journalControls.guide.full));
    if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
  }
});

test("guide section labels translate without rewriting source instructions, examples or references", async () => {
  const guide = {
    intro: "Original introduction", whoFills: "Customer role", whenToFill: "Customer schedule",
    prepare: ["Customer equipment"], steps: [{ title: "Original step", body: "Keep 4 °C", tip: "Original tip" }],
    examples: [{ label: "Original example", value: "O‘tkir 2026-10-15" }],
    mistakes: ["Original caution"], redFlags: [{ trigger: "Original trigger", action: "Original action" }],
    legalRef: "REF 021/2011",
  };
  const original = JSON.stringify(guide);
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, messages: { journalControls: messages.journalControls }, timeZone: "Europe/Moscow", onError: error => { throw error; },
      children: createElement(JournalDocGuideBody, { guide }),
    }));
    for (const value of [guide.intro, guide.whoFills, guide.whenToFill, guide.prepare[0], guide.steps[0].body, guide.examples[0].value, guide.legalRef]) assert.ok(html.includes(value));
    assert.ok(html.includes(messages.journalControls.guideSections.examples));
    assert.ok(html.includes(messages.journalControls.guideSections.redFlags));
    if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
  }
  assert.equal(JSON.stringify(guide), original);
});

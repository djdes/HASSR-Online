/* eslint-disable react/no-children-prop -- Explicit SSR fixture children. */
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
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { visionErrorMessageKey } from "@/lib/ai-vision/presentation";
import { VISION_FIELDS } from "@/lib/ai-vision/shared";

type Props = Record<string, unknown>;
const require = createRequire(import.meta.url);

/** Replace DOM portals and initial hook state only; render actual production JSX and ICU. */
function fixture(path: string, initial: unknown[]) {
  let stateIndex = 0;
  const states = [...initial];
  const nodes: { type: unknown; props: Props }[] = [];
  const notices: string[] = [];
  const wrappedJsx = (fn: typeof jsxRuntime.jsx) => (type: unknown, props: Props, key?: string) => {
    nodes.push({ type, props });
    return fn(type as React.ElementType, props, key);
  };
  const fragment = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  const portalAdapter = new Proxy({}, { get: () => fragment });
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const fixtureModule = { exports: {} };
  vm.runInNewContext(output, {
    module: fixtureModule, exports: fixtureModule.exports, AbortController, FormData, Blob, URL,
    require: (id: string) => {
      if (id === "react") return { ...React, useState: (fallback: unknown) => {
        const index = stateIndex++;
        if (index >= states.length) states[index] = typeof fallback === "function" ? fallback() : fallback;
        return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      } };
      if (id === "react/jsx-runtime") return { ...jsxRuntime, jsx: wrappedJsx(jsxRuntime.jsx), jsxs: wrappedJsx(jsxRuntime.jsxs) };
      if (id === "@/components/ui/dialog" || id === "@/components/ui/popover") return portalAdapter;
      if (id === "sonner") return { toast: { success: (s: string) => notices.push(s), info: (s: string) => notices.push(s), error: (s: string) => notices.push(s) } };
      return require(id);
    },
  });
  return { exports: fixtureModule.exports, nodes, states, notices };
}

async function render(locale: "ru" | "en" | "uz", child: React.ReactNode) {
  const messages = await loadMessages(locale);
  return renderToStaticMarkup(React.createElement(NextIntlClientProvider, {
    locale, messages: { journalControls: messages.journalControls, common: messages.common }, timeZone: "Europe/Moscow",
    onError: error => { throw error; }, children: child,
  }));
}

test("time entry translates open controls and preserves time normalization, disabled state and custom input", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    for (const value of ["830", "25", ""]) {
      const f = fixture("src/components/journals/time-entry-field.tsx", [true]);
      const { TimeEntryField } = f.exports as typeof import("./time-entry-field");
      const changes: string[] = [];
      let fills = 0;
      const html = await render(locale, React.createElement(TimeEntryField, {
        value, ariaLabel: "Custom O‘tkir", placeholder: "CUSTOM", testId: "time", onChange: v => changes.push(v), onFillBelow: () => fills++,
      }));
      assert.ok(html.includes("Custom O‘tkir") && html.includes('placeholder="CUSTOM"'));
      assert.match(html, /time-picker-hour-23/);
      assert.match(html, /time-picker-minute-55/);
      if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
      const input = f.nodes.find(n => n.props["data-testid"] === "time")!.props;
      assert.equal(input["aria-invalid"], value === "25" ? true : undefined);
      (input.onBlur as (e: unknown) => void)({ target: { value: "830" } });
      assert.deepEqual(changes, ["08:30"]);
      const fill = f.nodes.find(n => n.props["data-testid"] === "time-fill-below")!.props;
      assert.equal(fill.disabled, value !== "830");
      if (!fill.disabled) (fill.onClick as () => void)();
      assert.equal(fills, value === "830" ? 1 : 0);
    }
  }
});

test("photo recognition renders all five phases and every field in three locales without altering extracted values", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    for (const kind of ["menu", "raw", "generic"] as const) {
      for (const phase of ["photos", "recognizing", "review", "empty", "error"] as const) {
        const values = Object.fromEntries(VISION_FIELDS[kind].map(field => [field, field === "time" ? "830" : "Custom O‘tkir"]));
        const rows = [{ key: "original-id", checked: true, values }];
        const f = fixture("src/components/ai/recognize-from-photo.tsx", [true, phase, [], false, "SERVER-DETAIL", rows, true, 55, true, false]);
        const { RecognizeFromPhoto } = f.exports as typeof import("../ai/recognize-from-photo");
        const html = await render(locale, React.createElement(RecognizeFromPhoto, { kind, onItems() {} }));
        assert.ok(f.nodes.some(node => node.props["data-phase"] === phase));
        if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u, `${locale}/${kind}/${phase}`);
        if (phase === "review") {
          for (const field of VISION_FIELDS[kind]) assert.ok(html.includes(`photo-recognize-${field}-0`));
          assert.ok(html.includes("Custom O‘tkir"));
          assert.ok(html.includes("200"));
          assert.equal(rows[0].values.name, "Custom O‘tkir");
        }
        if (phase === "recognizing") assert.ok(html.includes("55"));
        if (phase === "error") assert.ok(html.includes("SERVER-DETAIL"));
      }
    }
  }
});

test("recognition addition preserves caller labels, row payloads, skipped/overflow counts and time normalization", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const f = fixture("src/components/ai/recognize-from-photo.tsx", [true, "review", [], false, null, [
      { key: "saved", checked: true, values: { name: "  Плов O‘tkir  ", yield: "250 г", time: "830" } },
      { key: "skip", checked: false, values: { name: "Do not add", yield: "", time: "" } },
    ], false, 0, false, false]);
    const { RecognizeFromPhoto } = f.exports as typeof import("../ai/recognize-from-photo");
    let result: unknown;
    const html = await render(locale, React.createElement(RecognizeFromPhoto, {
      kind: "menu", label: "USER LABEL", title: "USER TITLE", hint: "USER HINT", resultLabel: "USER RESULT",
      onItems(items) { result = items; return { added: 1, skipped: 21, overflow: 5 }; },
    }));
    assert.ok(html.includes("USER LABEL") && html.includes("USER TITLE"));
    (f.nodes.find(n => n.props["data-testid"] === "photo-recognize-add")!.props.onClick as () => void)();
    await new Promise(resolve => setImmediate(resolve));
    // Cross-VM objects have different prototypes; compare serialized payloads.
    assert.equal(JSON.stringify(result), JSON.stringify([{ name: "Плов O‘tkir", yield: "250 г", time: "08:30" }]));
    assert.equal(f.notices.length, 1);
    for (const expected of ["USER RESULT", "21", "5"]) assert.ok(f.notices[0].includes(expected));
    if (locale !== "ru") assert.doesNotMatch(f.notices[0], /\p{Script=Cyrillic}/u);
    assert.equal(f.states[0], false, "successful add closes the dialog");
  }
});

test("stable vision errors and numeric plurals format in all locales; unknown codes never become keys", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages, namespace: "journalControls.photoRecognition", onError: error => { throw error; } });
    for (const code of ["bad_request", "too_large", "bad_type", "limit", "not_configured", "timeout", "failed", "__proto__", {}, null]) {
      const text = t(visionErrorMessageKey(code, 500));
      assert.ok(text.length > 10);
      if (locale !== "ru") assert.doesNotMatch(text, /\p{Script=Cyrillic}/u);
    }
    assert.equal(visionErrorMessageKey("failed", 401), "errors.unauthorized");
    assert.equal(visionErrorMessageKey("failed", 403), "errors.forbidden");
    for (const count of [0, 1, 2, 5, 21]) assert.ok(t("addRows", { count }).includes(String(count)));
  }
});

test("callback failures use localized feedback and retain the review and selected values", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const error of [new Error("Не удалось подготовить изменения"), new Error("Failed to fetch")]) {
      const rows = [{ key: "saved", checked: true, values: { name: "Плов O‘tkir" } }];
      const f = fixture("src/components/ai/recognize-from-photo.tsx", [true, "review", [], false, null, rows, false, 0, false, false]);
      const { RecognizeFromPhoto } = f.exports as typeof import("../ai/recognize-from-photo");
      await render(locale, React.createElement(RecognizeFromPhoto, { kind: "generic", onItems() { throw error; } }));
      (f.nodes.find(n => n.props["data-testid"] === "photo-recognize-add")!.props.onClick as () => void)();
      await new Promise(resolve => setImmediate(resolve));
      const key = error.message === "Failed to fetch" ? "networkError" : "addFailed";
      assert.deepEqual(f.notices, [messages.journalControls.photoRecognition[key]]);
      assert.equal(f.states[0], true);
      assert.equal(f.states[1], "review");
      assert.equal(f.states[5], rows);
      assert.equal(f.states[9], false);
    }
  }
});

test("page help chrome translates while caller content remains intact in open and dismissed states", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    for (const [open, dismissed] of [[true, false], [false, true]]) {
      const f = fixture("src/components/ui/page-guide.tsx", [open, dismissed]);
      const { PageGuide } = f.exports as typeof import("../ui/page-guide");
      const html = await render(locale, React.createElement(PageGuide, {
        title: "Original title", bullets: ["Original content"], qa: [{ q: "Original question", a: "Original answer" }], storageKey: "original-key",
      }));
      if (open) for (const text of ["Original title", "Original content", "Original answer"]) assert.ok(html.includes(text));
      if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
    }
  }
});

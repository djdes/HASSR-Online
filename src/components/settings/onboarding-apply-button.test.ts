/* eslint-disable react/no-children-prop -- Isolated SSR providers use explicit children. */
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
import type { Locale } from "@/i18n/locales";
import type { OnboardingApplyButton } from "./onboarding-apply-button";

const require = createRequire(import.meta.url);
const codes = ["restaurant", "meat", "dairy", "bakery", "confectionery", "other"] as const;
type Props = React.ComponentProps<typeof OnboardingApplyButton>;
type Node = { type: unknown; props: Record<string, unknown> };

/** Production JSX and handlers with only hook storage, network and toast I/O isolated. */
function fixture(fetcher: typeof fetch = async () => { throw new Error("Unexpected request"); }) {
  let cursor = 0;
  let refCursor = 0;
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  const effects: (() => void)[] = [];
  const nodes: Node[] = [];
  const successes: string[] = [];
  const errors: string[] = [];
  let refreshes = 0;
  const wrap = (fn: typeof jsxRuntime.jsx) => (type: unknown, props: Node["props"], key?: string) => {
    nodes.push({ type, props });
    return fn(type as React.ElementType, props, key);
  };
  const output = ts.transpileModule(readFileSync("src/components/settings/onboarding-apply-button.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const fixtureModule = { exports: {} as { OnboardingApplyButton: typeof OnboardingApplyButton } };
  vm.runInNewContext(output, {
    module: fixtureModule, exports: fixtureModule.exports, fetch: fetcher, Error, TypeError,
    require: (id: string) => {
      if (id === "react") return { ...React,
        useRef: (value: unknown) => { const index = refCursor++; return refs[index] ?? (refs[index] = { current: value }); },
        useEffect: (effect: () => void) => { effects.push(effect); },
        useState: (fallback: unknown) => {
        const index = cursor++;
        if (index >= states.length) states[index] = typeof fallback === "function" ? fallback() : fallback;
        return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      } };
      if (id === "react/jsx-runtime") return { ...jsxRuntime, jsx: wrap(jsxRuntime.jsx), jsxs: wrap(jsxRuntime.jsxs) };
      if (id === "sonner") return { toast: { success: (message: string) => successes.push(message), error: (message: string) => errors.push(message) } };
      return require(id);
    },
  });
  return {
    states, nodes, successes, errors,
    get refreshes() { return refreshes; },
    async render(locale: Locale, props: Props) {
      cursor = 0; refCursor = 0; nodes.length = 0; effects.length = 0;
      const messages = await loadMessages(locale);
      const router = { back() {}, forward() {}, push() {}, replace() {}, prefetch() {}, refresh() { refreshes++; } };
      const html = renderToStaticMarkup(React.createElement(AppRouterContext.Provider, {
        value: router, children: React.createElement(NextIntlClientProvider, {
          locale, messages: { settingsManagement: messages.settingsManagement }, timeZone: "UTC", onError: error => { throw error; },
          children: React.createElement(fixtureModule.exports.OnboardingApplyButton, props),
        }),
      }));
      for (const effect of effects) effect();
      return html;
    },
    change(type: "select" | "input", value: unknown) {
      const node = nodes.find(node => node.type === type);
      assert.ok(node);
      (node.props.onChange as (event: unknown) => void)({ target: type === "select" ? { value } : { checked: value } });
    },
    async apply() {
      const node = nodes.find(node => typeof node.props.onClick === "function" && node.props.onClick.name === "apply");
      assert.ok(node);
      await (node.props.onClick as () => Promise<void>)();
    },
  };
}

test("onboarding application renders six stable options, accessible labels, custom headings and accurate copy in three locales", async () => {
  const baseline = (await loadMessages("ru")).settingsManagement.onboardingApply;
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const copy = messages.settingsManagement.onboardingApply;
    assert.deepEqual(validateCatalog(baseline, copy), []);
    for (const code of codes) {
      const view = fixture();
      const html = await view.render(locale, { orgType: code, showSeedStaff: true });
      assert.ok(html.includes(copy.description));
      assert.ok(html.includes(copy.types[code]));
      assert.ok(html.includes(copy.seedStaff));
      assert.deepEqual(view.nodes.filter(node => node.type === "option").map(node => node.props.value), codes);
      const select = view.nodes.find(node => node.type === "select")!;
      assert.equal(select.props.value, code);
      assert.ok(view.nodes.some(node => node.type === "label" && node.props.htmlFor === select.props.id && node.props.children === copy.companyType));
      assert.equal(view.states[1], true);
    }
    const custom = fixture();
    assert.ok((await custom.render(locale, { orgType: "unknown-original", label: "Custom {preset} heading" })).includes("Custom {preset} heading"));
    assert.equal(custom.states[2], "unknown-original", "legacy type is not rewritten by translation");
    assert.equal(custom.nodes.some(node => node.type === "input"), false);
  }
});

test("actual apply handler preserves payload flags/type/seed and renders complete localized success counts", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const seed of [false, true]) {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const view = fixture(async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ ok: true, type: "dairy", presetLabel: "UNTRUSTED RUSSIAN LABEL", positionsCreated: 14, journalAccessRowsCreated: 21, staffCreated: 3, orgUpdated: { autoJournalCodes: ["hygiene", "cleaning"], disabledJournalCodes: ["irrelevant"] } });
    });
    const props = { orgType: "restaurant", showSeedStaff: true };
    await view.render(locale, props);
    view.change("select", "dairy"); view.change("input", seed);
    const html = await view.render(locale, props);
    const messages = await loadMessages(locale);
    assert.ok(html.includes(messages.settingsManagement.onboardingApply.typeChanged));
    await view.apply();
    assert.equal(requests[0].url, "/api/onboarding/apply");
    assert.equal(requests[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { type: "dairy", updateOrgType: true, seedDemoStaff: seed, applyJournalAccess: true, applyDisabledJournals: false, applyAutoJournals: true });
    const t = createTranslator({ locale, messages, namespace: "settingsManagement.onboardingApply" });
    const values = { preset: t("types.dairy"), positions: 14, access: 21, automatic: 2 };
    assert.deepEqual(view.successes, [seed ? t("successWithStaff", { ...values, staff: 3 }) : t("success", values)]);
    assert.equal(view.refreshes, 1);
    assert.equal(view.states[0], false);
    assert.deepEqual(view.errors, []);
  }
});

test("unknown server text, invalid success responses and network failures only show localized safe errors", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const errors = (await loadMessages(locale)).settingsManagement.onboardingApply.errors;
    const scenarios: [typeof fetch, string][] = [
      ...([400, 403, 404, 500] as const).map(status => [async () => Response.json({ error: "RAW SERVER MESSAGE" }, { status }), errors[status === 400 ? "invalid" : status === 403 ? "forbidden" : status === 404 ? "notFound" : "failed"]] as [typeof fetch, string]),
      [async () => { throw new TypeError("RAW NETWORK MESSAGE"); }, errors.network],
      [async () => new Response("not JSON"), errors.failed],
      [async () => Response.json({ positionsCreated: "wrong", journalAccessRowsCreated: 1 }), errors.failed],
      [async () => Response.json({ positionsCreated: 1, journalAccessRowsCreated: 2, orgUpdated: { autoJournalCodes: [3] } }), errors.failed],
    ];
    for (const [fetcher, expected] of scenarios) {
      const view = fixture(fetcher);
      await view.render(locale, { orgType: "restaurant" });
      await view.apply();
      assert.deepEqual(view.errors, [expected]);
      assert.deepEqual(view.successes, []);
      assert.equal(view.states[0], false);
      assert.equal(view.refreshes, 0);
    }
  }
});

test("type and seed drafts plus pending application survive state-retaining locale rerenders", async () => {
  const deferred = Promise.withResolvers<Response>();
  let payload: unknown;
  const view = fixture(async (_url, init) => { payload = JSON.parse(String(init?.body)); return deferred.promise; });
  const props = { orgType: "restaurant", showSeedStaff: true };
  await view.render("ru", props);
  view.change("select", "bakery"); view.change("input", false);
  await view.render("en", props);
  const pending = view.apply();
  assert.equal(view.states[0], true);
  for (const locale of ["uz", "ru"] as const) {
    const html = await view.render(locale, props);
    assert.ok(html.includes((await loadMessages(locale)).settingsManagement.onboardingApply.applying));
    assert.deepEqual(view.states, [true, false, "bakery"]);
    assert.equal(view.nodes.find(node => node.type === "select")?.props.disabled, true);
  }
  assert.deepEqual(payload, { type: "bakery", updateOrgType: true, seedDemoStaff: false, applyJournalAccess: true, applyDisabledJournals: false, applyAutoJournals: true });
  deferred.resolve(Response.json({ type: "bakery", positionsCreated: 0, journalAccessRowsCreated: 0 }));
  await pending;
  assert.deepEqual(view.states, [false, false, "bakery"]);
  const t = createTranslator({ locale: "ru", messages: await loadMessages("ru"), namespace: "settingsManagement.onboardingApply" });
  assert.deepEqual(view.successes, [t("success", { preset: t("types.bakery"), positions: 0, access: 0, automatic: 0 })]);
});

test("deferred server and network errors use the current locale while submitted options remain captured", async () => {
  for (const reject of [false, true]) {
    const deferred = Promise.withResolvers<Response>();
    let payload: unknown;
    const view = fixture(async (_url, init) => { payload = JSON.parse(String(init?.body)); return deferred.promise; });
    const props = { orgType: "restaurant", showSeedStaff: true };
    await view.render("en", props);
    const pending = view.apply();
    await view.render("uz", props);
    assert.deepEqual(payload, { type: "restaurant", updateOrgType: false, seedDemoStaff: true, applyJournalAccess: true, applyDisabledJournals: false, applyAutoJournals: true });
    if (reject) deferred.reject(new TypeError("Raw network message"));
    else deferred.resolve(Response.json({ error: "Raw server message" }, { status: 403 }));
    await pending;
    const copy = (await loadMessages("uz")).settingsManagement.onboardingApply.errors;
    assert.deepEqual(view.errors, [reject ? copy.network : copy.forbidden]);
  }
});

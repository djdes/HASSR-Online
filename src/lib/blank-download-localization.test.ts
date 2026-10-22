import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { blankConsentRows, BLANK_CONSENT_TEXT, BLANK_MARKETING_CONSENT_TEXT } from "./blank-download";
import { blankConsentSnapshot, blankDownloadErrorKey, blankMarketingConsentSnapshot } from "./blank-download-presentation";

type Dict = Record<string, unknown>;
type Locale = "ru" | "en" | "uz";
type HookComponent = (props: Dict) => unknown;
const repository = process.cwd();
const batch = path.join(repository, ".agent/tasks/english-version-1375e736/batches/public-blank-download");
const preparedSourceRoot = path.resolve(path.join(batch, "prepared/src"));
const sourceRoot = path.resolve(process.env.BLANK_DOWNLOAD_SOURCE_ROOT ?? path.join(repository, "src"));
const isPreparedSource = sourceRoot === preparedSourceRoot;
const requireFromRepo = createRequire(import.meta.url);

function catalogFor(locale: Locale): Dict {
  const catalogPath = isPreparedSource
    ? path.join(batch, `${locale}.json`)
    : path.join(repository, `src/i18n/messages/${locale}.json`);
  return JSON.parse(readFileSync(catalogPath, "utf8")) as Dict;
}

function atPath(root: Dict, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Dict)[part] : undefined, root);
}

function loadStagedParser() {
  const source = readFileSync(path.join(sourceRoot, "lib/blank-download-targets.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Dict = {};
  const modules: Record<string, unknown> = {
    zod: requireFromRepo("zod"),
    "@/lib/blank-download": { normalizeBlankEmail: (value: unknown) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null },
    "@/lib/document-docx": { DOCX_SAMPLE_CODES: ["hygiene"] },
    "@/lib/journal-catalog": { ACTIVE_JOURNAL_CATALOG: [{ code: "hygiene", name: "Гигиенический журнал", formats: ["pdf"] }] },
    "@/lib/sphere-journal-rules": { paperJournalById: (id: string) => id === "paper-1" ? { name: "Paper title" } : null },
    "@/lib/blank-download-presentation": { normalizeBlankDownloadLocale: (value: unknown) => value === "en" || value === "uz" ? value : "ru" },
  };
  vm.runInNewContext(js, { exports, module: { exports }, require: (name: string) => modules[name] }, { filename: "blank-download-targets.js" });
  return exports.parseBlankDownloadRequest as (body: unknown, version: string) => { ok: boolean; status?: number; errorCode?: string; needConsent?: boolean; value?: Dict };
}

function text(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "object" && "props" in node) return text((node as { props?: { children?: unknown } }).props?.children);
  return "";
}

type ViewNode = { props: Dict };

function invoke(node: ViewNode | null, key: string, event: unknown) {
  const handler = node?.props[key];
  assert.equal(typeof handler, "function", `missing event handler ${key}`);
  return (handler as (value: unknown) => unknown)(event);
}

function find(node: unknown, predicate: (props: Dict) => boolean): ViewNode | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) { const match = find(child, predicate); if (match) return match; }
    return null;
  }
  const item = node as Dict;
  const props = (item.props && typeof item.props === "object" ? item.props : {}) as Dict;
  if (predicate(props)) return { ...item, props };
  return find(props.children, predicate);
}

function render(locale: Locale, response: { status: number; body: Dict }) {
  const catalogs = Object.fromEntries((["ru", "en", "uz"] as const).map((key) => [key, catalogFor(key)])) as Record<Locale, Dict>;
  let currentLocale = locale;
  const states = new Map<HookComponent, unknown[]>();
  const cursors = new Map<HookComponent, number>();
  const refs = new Map<HookComponent, unknown[]>();
  let current: HookComponent = () => undefined;
  let fetchCount = 0;
  let requestBody: Dict | null = null;
  const goals: string[] = [];
  const historyChanges: string[] = [];
  const stored = new Map<string, string>();
  const getArray = (map: Map<HookComponent, unknown[]>) => { let value = map.get(current); if (!value) map.set(current, value = []); return value; };
  const useState = <T,>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] => {
    const values = getArray(states); const index = cursors.get(current) ?? 0; cursors.set(current, index + 1);
    if (!(index in values)) values[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [values[index] as T, (value) => { values[index] = typeof value === "function" ? (value as (previous: T) => T)(values[index] as T) : value; }];
  };
  const useRef = <T,>(initial: T) => {
    const values = getArray(refs); const index = cursors.get(current) ?? 0; cursors.set(current, index + 1);
    if (!(index in values)) values[index] = { current: initial };
    return values[index] as { current: T };
  };
  const messages = (key: string, values: Dict = {}) => {
    const raw = atPath(catalogs[currentLocale], `publicBlankDownload.${key}`);
    assert.equal(typeof raw, "string", `missing ${currentLocale} publicBlankDownload.${key}`);
    return String(raw).replace(/<([a-zA-Z]+)>([\s\S]*?)<\/\1>/g, (_whole, tag: string, content: string) => {
      const formatter = values[tag];
      return typeof formatter === "function" ? text((formatter as (chunks: string) => unknown)(content.replace(/\{([^}]+)\}/g, (_m, name: string) => String(values[name] ?? "")))) : content;
    }).replace(/\{([^}]+)\}/g, (_whole, name: string) => String(values[name] ?? ""));
  };
  const useTranslations = () => Object.assign(
    (key: string, values?: Dict) => messages(key, values),
    { rich: (key: string, values?: Dict) => messages(key, values) },
  );
  const useEffect = (effect: () => void | (() => void)) => { effect(); };
  const useEmailField = (initial: string) => {
    const [value, setValue] = useState(initial);
    return { value, setValue, valid: true, check: { status: "ok" }, domainState: "ok", touched: false, setTouched() {}, applySuggestion() {} };
  };
  const passthrough = ({ children, ...props }: Dict) => jsxRuntime.jsx("div", { ...props, children });
  const modules: Record<string, unknown> = {
    react: { ...React, useState, useRef, useEffect },
    "react/jsx-runtime": jsxRuntime,
    "react-dom": { createPortal: (node: unknown) => node },
    "next-intl": { useLocale: () => currentLocale, useTranslations },
    "next/link": ({ children, ...props }: Dict) => jsxRuntime.jsx("a", { ...props, children }),
    "lucide-react": Object.fromEntries(["ArrowRight", "CheckCircle2", "Download", "Loader2", "Mail"].map((name) => [name, (props: Dict) => jsxRuntime.jsx("i", { ...props, "data-icon": name })])),
    "@/components/ui/dialog": Object.fromEntries(["Dialog", "DialogContent", "DialogDescription", "DialogHeader", "DialogTitle"].map((name) => [name, passthrough])),
    "@/components/ui/email-field": { EmailHint: () => null, useEmailField },
    "@/lib/blank-download": {
      BLANK_EMAIL_STORAGE_KEY: "blank-email", BLANK_FORMAT_LABEL: { pdf: "PDF", docx: "Word" },
      blankFilePath: () => "/blank.pdf", blankRegisterHref: ({ email }: { email: string }) => `/register?email=${encodeURIComponent(email)}`, readRememberedBlankEmail: (raw: string | null) => raw ? JSON.parse(raw) : null,
    },
    "@/lib/signup-source": { ymGoal: (name: string) => goals.push(name) },
    "@/lib/utils": { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") },
    "@/lib/native-bridge": { downloadFile() {} },
    "@/i18n/site-locale": { localizedHref(href: string, locale: Locale) { return locale === "ru" ? href : `/${locale}${href}`; } },
    "@/lib/blank-download-presentation": {
      blankDownloadErrorKey(code: unknown, needConsent = false) {
        const map: Record<string, string> = { email_domain: "emailDomain", rate_limit_email: "rateLimitEmail", consent_version: "consentVersion" };
        return typeof code === "string" && Object.hasOwn(map, code) ? map[code] : needConsent ? "consentRequired" : "generic";
      },
    },
  };
  const source = readFileSync(path.join(sourceRoot, "components/public/blank-download-client.tsx"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Dict = {};
  const context = {
    exports, module: { exports }, require: (name: string) => modules[name],
    fetch: async (_url: string, init: { body: string }) => { fetchCount += 1; requestBody = JSON.parse(init.body); return { ok: response.status >= 200 && response.status < 300, json: async () => response.body }; },
    window: { localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) }, location: { href: "https://example.test/?download=pdf&expired=1&paper=p1" }, history: { state: null, replaceState(_state: unknown, _title: string, url: string) { historyChanges.push(url); } } },
    document: { body: {}, createElement: () => ({ click() {}, remove() {} }), appendChild() {} },
    setTimeout: () => 1, clearTimeout() {}, URL, console,
  };
  vm.runInNewContext(js, context, { filename: "blank-download-client.js" });

  const root = (overrides: Dict = {}) => jsxRuntime.jsx(exports.BlankDownloadClient as React.ElementType, {
    target: { kind: "code", code: "hygiene" }, format: "pdf", title: "Журнал гигиены",
    children: jsxRuntime.jsx("span", { children: "PDF" }), ...overrides,
  });
  const draw = (element: unknown): unknown => {
    if (element == null || typeof element !== "object") return element;
    if (Array.isArray(element)) return element.map(draw);
    const item = element as { type?: unknown; props?: Dict };
    if (!item.props) return element;
    if (typeof item.type === "function") {
      const previous = current; current = item.type as HookComponent; cursors.set(current, 0);
      const output = current(item.props);
      current = previous;
      return draw(output);
    }
    return { ...item, props: { ...item.props, children: draw(item.props.children) } };
  };
  const tree = (overrides: Dict = {}) => { cursors.clear(); current = exports.BlankDownloadClient as HookComponent; return draw(root(overrides)); };
  return { tree, find, text, messages, setLocale(value: Locale) { currentLocale = value; }, get fetchCount() { return fetchCount; }, get requestBody() { return requestBody; }, goals, stored, historyChanges };
}

for (const locale of ["ru", "en", "uz"] as const) {
  test(`${locale}: real blank-download client agrees consent snapshot, preserves opt-in defaults and maps unknown errors`, async () => {
    const app = render(locale, { status: 400, body: { error: "private raw diagnostic", errorCode: "private_unknown_code" } });
    let tree = app.tree();
    const trigger = find(tree, (node) => node["data-testid"] === "blank-download-pdf");
    assert.ok(trigger);
    invoke(trigger, "onClick", { preventDefault() {} });
    tree = app.tree();
    const consent = find(tree, (node) => node["data-testid"] === "blank-download-consent");
    const marketing = find(tree, (node) => node["data-testid"] === "blank-download-marketing");
    assert.ok(consent && marketing);
    assert.equal((consent.props as Dict).checked, false);
    assert.equal((marketing.props as Dict).checked, false);
    const consentLabel = find(tree, (node) => Boolean(node.className) && String(node.className).includes("mt-4"));
    assert.ok(consentLabel);
    const localeCatalog = catalogFor(locale);
    const richConsent = atPath(localeCatalog, "publicBlankDownload.consent.statement") as string;
    assert.equal(app.text(consentLabel), app.messages("consent.statement"));
    assert.equal(blankConsentSnapshot(richConsent), app.text(consentLabel), "LegalConsent text is the exact visible rich sentence");
    const marketingLabel = find(tree, (node) => String(node.className ?? "").includes("mt-1 flex cursor-pointer"));
    assert.ok(marketingLabel);
    const richMarketing = atPath(localeCatalog, "publicBlankDownload.marketing.statement") as string;
    assert.equal(blankMarketingConsentSnapshot(richMarketing), app.text(marketingLabel), "marketing consent text matches visible label and note punctuation");

    const form = find(tree, (node) => typeof node.onSubmit === "function");
    assert.ok(form);
    const emailInput = find(tree, (node) => node.id === "blank-download-email");
    assert.ok(emailInput);
    invoke(emailInput, "onChange", { target: { value: "Person@Example.test" } });
    const updatedForm = find(app.tree(), (node) => typeof node.onSubmit === "function");
    invoke(updatedForm, "onSubmit", { preventDefault() {} });
    tree = app.tree();
    assert.equal(app.text(find(tree, (node) => node.role === "alert")), app.messages("error.consentRequired"));
    assert.equal(app.fetchCount, 0, "missing consent must not submit");

    invoke(consent, "onChange", { target: { checked: true } });
    tree = app.tree();
    const check = find(tree, (node) => node["data-testid"] === "blank-download-consent");
    invoke(check, "onChange", { target: { checked: true } });
    if (locale === "uz") {
      const marketingCheck = find(app.tree(), (node) => node["data-testid"] === "blank-download-marketing");
      invoke(marketingCheck, "onChange", { target: { checked: true } });
    }
    const currentForm = find(app.tree(), (node) => typeof node.onSubmit === "function");
    invoke(currentForm, "onSubmit", { preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(app.fetchCount, 1);
    assert.equal(app.requestBody?.locale, locale);
    assert.equal(app.requestBody?.consent, true);
    assert.equal(app.requestBody?.email, "person@example.test");
    assert.equal(app.requestBody?.marketing, locale === "uz" ? true : undefined, "marketing remains opt-in and preserves its selected value");
    tree = app.tree();
    const alert = find(tree, (node) => node.role === "alert");
    assert.ok(alert);
    assert.equal(app.text(alert), app.messages("error.generic"));
    assert.ok(!app.text(alert).includes("private raw diagnostic"));
  });
}

test("legacy consent helper defaults remain byte-for-byte compatible for existing callers", () => {
  const rows = blankConsentRows({ email: "person@example.test", version: "v1", marketing: true, ipAddress: null, userAgent: null });
  assert.equal(rows[0].statementText, BLANK_CONSENT_TEXT);
  assert.equal(rows[1].statementText, BLANK_MARKETING_CONSENT_TEXT);
});

test("late remembered-download feedback renders the current locale without replaying the request", async () => {
  const app = render("en", { status: 200, body: { ok: true, url: "/download?token=opaque", consentVersion: "v1", emailed: true } });
  let tree = app.tree();
  const trigger = app.find(tree, (node) => node["data-testid"] === "blank-download-pdf");
  invoke(trigger, "onClick", { preventDefault() {} });
  tree = app.tree();
  const emailInput = app.find(tree, (node) => node.id === "blank-download-email");
  invoke(emailInput, "onChange", { target: { value: "reader@example.test" } });
  tree = app.tree();
  const consent = app.find(tree, (node) => node["data-testid"] === "blank-download-consent");
  invoke(consent, "onChange", { target: { checked: true } });
  const form = app.find(app.tree(), (node) => typeof node.onSubmit === "function");
  invoke(form, "onSubmit", { preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.fetchCount, 1);

  const doneLink = app.find(app.tree(), (node) => typeof node.href === "string" && String(node.href).includes("register?email="));
  assert.equal(doneLink?.props?.href, "/en/register?email=reader%40example.test", "success CTA keeps the selected locale and encoded email");

  tree = app.tree();
  const triggerAgain = app.find(tree, (node) => node["data-testid"] === "blank-download-pdf");
  invoke(triggerAgain, "onClick", { preventDefault() {} });
  app.setLocale("uz");
  tree = app.tree();
  await new Promise((resolve) => setImmediate(resolve));
  tree = app.tree();
  const notice = app.find(tree, (node) => node["data-testid"] === "blank-download-notice");
  assert.ok(notice);
  assert.ok(app.text(notice).includes("Журнал гигиены"), "custom journal title remains unchanged");
  const sentence = app.find(notice, (node) => node.className === "min-w-0");
  assert.equal(app.text(sentence), app.messages("notice.emailed", { title: "Журнал гигиены", email: "reader@example.test" }));
  assert.equal(app.fetchCount, 2, "locale changes do not replay a download request");
});

test("auto-open removes legacy query flags and displays the expired-link notice", () => {
  const app = render("ru", { status: 200, body: {} });
  app.tree({ autoOpen: true, expired: true, hideTrigger: true });
  const tree = app.tree({ autoOpen: true, expired: true, hideTrigger: true });
  assert.equal(app.historyChanges.length, 1);
  assert.doesNotMatch(app.historyChanges[0], /download|expired|paper/);
  const expired = app.find(tree, (node) => String(node.className ?? "").includes("#fff4f2"));
  assert.ok(expired);
  assert.equal(app.text(expired), app.messages("dialog.expired"));
  assert.equal(app.find(tree, (node) => node["data-testid"] === "blank-download-pdf"), null);
});

test("consent snapshots preserve visible strings and unknown server codes use a safe fallback", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const catalog = catalogFor(locale);
    const consent = atPath(catalog, "publicBlankDownload.consent.statement") as string;
    const marketing = atPath(catalog, "publicBlankDownload.marketing.statement") as string;
    assert.equal(blankConsentSnapshot(consent), consent.replace(/<\/?(?:consent|privacy)>/g, ""));
    assert.equal(blankMarketingConsentSnapshot(marketing), marketing.replace(/<\/?(?:lead|note)>/g, ""));
  }
  assert.equal(blankDownloadErrorKey("private-diagnostic"), "generic");
  assert.equal(blankDownloadErrorKey("private-diagnostic", true), "consentRequired");
  assert.equal(blankDownloadErrorKey("email_domain"), "emailDomain");
});

test("API parser adds optional locale and error codes without changing legacy status/target behavior", () => {
  const parse = loadStagedParser();
  const legacy = parse({ email: "Person@Example.test", code: "hygiene", format: "docx", consent: true }, "v1");
  assert.equal(legacy.ok, true);
  assert.equal(legacy.value?.email, "person@example.test");
  assert.equal(legacy.value?.locale, "ru", "absent locale keeps Russian compatibility default");
  assert.equal(legacy.value?.format, "docx");
  assert.equal((legacy.value?.info as Dict | undefined)?.target && ((legacy.value?.info as Dict).target as Dict).kind, "code");
  assert.equal(((legacy.value?.info as Dict).target as Dict).code, "hygiene");
  const uz = parse({ email: "a@example.test", paperId: "paper-1", format: "pdf", consent: true, locale: "uz" }, "v1");
  assert.equal(uz.ok, true);
  assert.equal(uz.value?.locale, "uz");
  assert.equal(((uz.value?.info as Dict).target as Dict).kind, "paper");
  assert.equal(((uz.value?.info as Dict).target as Dict).paperId, "paper-1");
  const unknownLocale = parse({ email: "a@example.test", code: "hygiene", format: "pdf", consent: true, locale: "unknown" }, "v1");
  assert.equal(unknownLocale.value?.locale, "ru", "unrecognized locale values preserve the Russian default");
  for (const locale of ["unsupported-locale", null, 42, [], {}]) {
    const malformedLocale = parse({ email: "a@example.test", code: "hygiene", format: "pdf", consent: true, locale }, "v1");
    assert.equal(malformedLocale.ok, true, `malformed locale ${String(locale)} does not reject a valid legacy request`);
    assert.equal(malformedLocale.value?.locale, "ru");
  }
  const stale = parse({ email: "a@example.test", code: "hygiene", format: "pdf", consent: true, remembered: true, consentVersion: "old", locale: "en" }, "v1");
  assert.equal(stale.status, 409);
  assert.equal(stale.errorCode, "consent_version");
  assert.equal(stale.needConsent, true);
  const missing = parse({ email: "a@example.test", code: "hygiene", format: "pdf" }, "v1");
  assert.equal(missing.status, 400);
  assert.equal(missing.errorCode, "consent_required");
  assert.equal(missing.needConsent, true);
});

test("server wrapper keeps the async domain boundary outside the client graph and inherits parent namespaces", () => {
  const wrapper = readFileSync(path.join(sourceRoot, "components/public/blank-download.tsx"), "utf8");
  const client = readFileSync(path.join(sourceRoot, "components/public/blank-download-client.tsx"), "utf8");
  const provider = readFileSync(path.join(repository, "src/components/i18n/domain-messages-provider.tsx"), "utf8");
  assert.doesNotMatch(wrapper, /^\s*["']use client["']/);
  assert.match(wrapper, /import\s+\{\s*DomainMessagesBoundary\s*\}\s+from/);
  assert.match(wrapper, /namespaces=\{\["publicBlankDownload"\]\}/);
  assert.match(client, /^\s*["']use client["']/);
  assert.doesNotMatch(client, /DomainMessagesBoundary/);
  assert.match(provider, /const parent = useMessages\(\)/);
  assert.match(provider, /\.\.\.parent, \.\.\.messages/);
  const serverImporters = [
    "src/app/blanki/page.tsx",
    "src/app/journals-info/[code]/page.tsx",
    "src/components/landing/seo-journal-landing.tsx",
  ];
  const seoRouteImporters = [
    "src/app/zhurnal-zdorovya/page.tsx", "src/app/zhurnal-uborki/page.tsx", "src/app/zhurnal-haccp/page.tsx",
    "src/app/temperaturnyy-list-holodilnika/page.tsx", "src/app/brakerazhnyy-zhurnal/page.tsx",
    "src/app/elektronnyy-zhurnal-sanpin/page.tsx", "src/app/haccp-dlya-kafe/page.tsx",
  ];
  for (const file of [...serverImporters, ...seoRouteImporters]) {
    const source = readFileSync(path.join(repository, file), "utf8");
    assert.doesNotMatch(source, /^\s*["']use client["']/m, `${file} remains a server-side importer`);
  }
  const route = readFileSync(path.join(sourceRoot, "app/api/public/blank-download/route.ts"), "utf8");
  assert.match(route, /blankConsentSnapshot\(consentRichMessage\)/);
  assert.match(route, /blankMarketingConsentSnapshot\(marketingRichMessage\)/);
  assert.match(route, /import\s+\{\s*LEGAL_VERSION\s*\}\s+from\s+"@\/lib\/legal-consent"/);
  assert.match(route, /version:\s*LEGAL_VERSION/);
  assert.match(route, /consentVersion:\s*LEGAL_VERSION/);
  assert.match(route, /sendBlankDownloadEmail\([\s\S]*?locale,/);
  assert.match(route, /localizedHref\(blankRegisterHref/);
  assert.match(route, /localizedProductTitle\(\(await loadMessages\(locale\)\)\.journals\.names, target, info\.title\)/);
  assert.match(route, /errorCode: limited\.scope === "ip" \? "rate_limit_ip" : "rate_limit_email"/);
});

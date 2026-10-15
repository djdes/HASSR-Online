/* eslint-disable react/no-children-prop -- Explicit fixture provider children. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import vm from "node:vm";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createTranslator } from "use-intl/core";
import { SiteLocaleProvider } from "@/components/i18n/site-locale-provider";
import { JOURNAL_INFO } from "@/content/journal-info";
import { JOURNAL_SEO } from "@/content/journal-seo";
import { buildJournalFaq } from "@/lib/journal-faq";
import { getFillingGuide } from "@/lib/journal-filling-guides";
import { DOCX_SAMPLE_CODES } from "@/lib/document-docx";
import { SAMPLE_JOURNAL_CODES } from "@/lib/journal-sample-fixtures";
import type { Locale } from "@/i18n/locales";
import type * as Routing from "@/i18n/site-locale";
import type { Metadata } from "next";

type Dict = Record<string, unknown>;
const staging = process.env.PUBLIC_DETAIL_SOURCE_ROOT;
const catalogRoot = process.env.PUBLIC_DETAIL_CATALOG_ROOT;
const catalogCache = new Map<Locale, Dict>();
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
function merge(target: Dict, patch: Dict): Dict {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) result[key] = value && typeof value === "object"
    ? merge((result[key] as Dict | undefined) ?? {}, value as Dict) : value;
  return result;
}
function messagesFor(locale: Locale) {
  const cached = catalogCache.get(locale); if (cached) return cached;
  let messages = JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8"));
  if (catalogRoot) for (const name of ["public-journal-detail-info", "public-journal-detail-seo", "public-journal-detail-page"]) {
    messages = merge(messages, JSON.parse(readFileSync(resolve(catalogRoot, name, `${locale}.json`), "utf8")));
  }
  catalogCache.set(locale, messages);
  return messages;
}
const owned = new Set([
  "src/app/journals-info/[code]/page.tsx", "src/app/en/journals-info/[code]/page.tsx", "src/app/uz/journals-info/[code]/page.tsx",
  "src/i18n/public-journal-detail-presentation.ts", "src/i18n/public-journal-detail-metadata.ts", "src/i18n/public-journal-detail-faq.ts",
  "src/i18n/public-journal-detail-codes.ts", "src/i18n/site-locale.ts", "src/components/i18n/localized-link.tsx",
]);
const sourceFile = (path: string) => staging && existsSync(resolve(staging, path)) ? resolve(staging, path) : resolve(path);
function modules(locale: Locale, downloads: Dict[]) {
  const cache = new Map<string, { exports: unknown }>();
  const mocks: Record<string, unknown> = {
    "@/i18n/site-locale-server": { getSiteLocale: async () => locale },
    "@/i18n/messages": { loadMessages: async () => messagesFor(locale) },
    "@/components/public/public-chrome": { PublicHeader: () => null, PublicFooter: () => null },
    "next/navigation": { notFound: () => { throw new Error("FIXTURE_NOT_FOUND"); } },
    "@/components/public/blank-download": { BlankDownloadButton: (props: Dict) => {
      downloads.push(props);
      return createElement("button", { "data-format": props.format }, props.children as ReactNode);
    } },
  };
  function actual<T>(path: string): T {
    const absolute = resolve(path);
    const found = cache.get(absolute); if (found) return found.exports as T;
    const compiled = { exports: {} }; cache.set(absolute, compiled);
    const require = createRequire(absolute);
    const code = ts.transpileModule(readFileSync(sourceFile(path), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, { module: compiled, exports: compiled.exports, URL, URLSearchParams, Date, console,
      require: (id: string) => {
        if (Object.hasOwn(mocks, id)) return mocks[id];
        if ((path.endsWith("metadata.ts")) && id === "./messages") return mocks["@/i18n/messages"];
        const candidate = id.startsWith("@/") ? resolve("src", id.slice(2)) : id.startsWith(".") ? resolve(dirname(absolute), id) : null;
        if (candidate) for (const extension of [".ts", ".tsx"]) {
          const local = relative(process.cwd(), candidate + extension).replaceAll("\\", "/");
          if (owned.has(local)) return actual(local);
        }
        return require(id);
      },
    }, { filename: sourceFile(path) });
    return compiled.exports as T;
  }
  return actual;
}

test("all 45 actual journal detail pages preserve RU content and localize body, metadata, FAQ, HowTo and routes in three locales", async () => {
const original = structuredClone({ JOURNAL_INFO, JOURNAL_SEO });
let variants = 0, metadataCases = 0, faqItems = 0, guideCases = 0;
for (const locale of ["ru", "en", "uz"] as const) {
  const messages = messagesFor(locale);
  const downloads: Dict[] = [];
  const actual = modules(locale, downloads);
  const routing = actual<typeof Routing>("src/i18n/site-locale.ts");
  const presentation = actual<{ presentPublicJournalDetail: (copy: Dict, locale: Locale, code: string) => {
    info: typeof JOURNAL_INFO[string]; seo: typeof JOURNAL_SEO[string]; name: string;
  } | null }>("src/i18n/public-journal-detail-presentation.ts");
  const page = actual<{
    default: (props: { params: Promise<{ code: string }>; searchParams: Promise<{ download?: string; expired?: string }> }) => Promise<ReactNode>;
    generateMetadata: (props: { params: Promise<{ code: string }> }) => Promise<Metadata>;
  }>(`src/app/${locale === "ru" ? "" : `${locale}/`}journals-info/[code]/page.tsx`);
  for (const code of Object.keys(JOURNAL_INFO)) {
    const detail = presentation.presentPublicJournalDetail(messages, locale, code);
    assert.ok(detail);
    if (locale === "ru") {
      assert.deepEqual(clean(detail.info), JOURNAL_INFO[code]);
      assert.deepEqual(clean(detail.seo), JOURNAL_SEO[code]);
    }
    const tree = await page.default({ params: Promise.resolve({ code }), searchParams: Promise.resolve({ download: "pdf", expired: "1" }) });
    downloads.length = 0;
    const html = renderToStaticMarkup(createElement(SiteLocaleProvider, { locale, messages, timeZone: "UTC", children: tree }));
    for (const text of [detail.name, detail.info.tagline, detail.info.why, ...detail.info.whatToFill, ...detail.info.tips, detail.seo.seoIntro]) {
      assert.ok(html.includes(escapeHtml(text)), `${locale}/${code}: missing body text ${text}`);
    }
    const jsonLd = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
    const faq = jsonLd.find(value => value["@type"] === "FAQPage"); assert.ok(faq);
    faqItems += faq.mainEntity.length;
    if (locale === "ru") assert.deepEqual(faq.mainEntity.map((value: { name: string; acceptedAnswer: { text: string } }) => ({ q: value.name, a: value.acceptedAnswer.text })), buildJournalFaq(JOURNAL_INFO[code], detail.name));
    const article = jsonLd.find(value => value["@type"] === "Article"); assert.ok(article);
    assert.equal(article.inLanguage, { ru: "ru-RU", en: "en-GB", uz: "uz-Latn" }[locale]);
    assert.equal(article.url, `https://wesetup.ru${routing.localizedHref(`/journals-info/${code}`, locale)}`);
    assert.equal(new URL(article.image[0]).searchParams.get("l"), locale);
    const guide = getFillingGuide(code); const howTo = jsonLd.find(value => value["@type"] === "HowTo");
    if (guide) {
      assert.ok(howTo); guideCases++;
      assert.equal(howTo.inLanguage, article.inLanguage);
      assert.equal(howTo.step.length, guide.steps.length);
      const tGuide = createTranslator({ locale, messages, namespace: "journalFillingGuides" });
      const tWalkthrough = createTranslator({ locale, messages, namespace: "journalControls.walkthroughs" });
      const translated = getFillingGuide(code, { guide: key => tGuide(key), walkthrough: key => tWalkthrough(key) });
      assert.equal(howTo.description, translated?.summary);
      assert.deepEqual(howTo.step.map((step: { text: string }) => step.text), translated?.steps.map(step => step.detail));
    } else assert.equal(howTo, undefined);
    assert.equal(downloads.length, SAMPLE_JOURNAL_CODES.includes(code as typeof SAMPLE_JOURNAL_CODES[number]) ? DOCX_SAMPLE_CODES.includes(code as typeof DOCX_SAMPLE_CODES[number]) ? 2 : 1 : 0);
    for (const download of downloads) {
      assert.deepEqual(clean(download.target), { kind: "code", code });
      assert.equal(download.autoOpen, download.format === "pdf");
      assert.equal(download.expired, download.format === "pdf");
    }
    const meta = await page.generateMetadata({ params: Promise.resolve({ code }) });
    assert.equal(meta.title, detail.seo.title); assert.equal(meta.description, detail.seo.description);
    assert.equal(meta.alternates?.canonical, article.url);
    assert.deepEqual(clean(meta.alternates?.languages), clean(routing.siteLanguageAlternates(`/journals-info/${code}`)));
    metadataCases++;
    if (process.env.PUBLIC_DETAIL_FIXTURE_DIR && ["hygiene", "climate_control", "traceability_test"].includes(code)) {
      const output = resolve(process.env.PUBLIC_DETAIL_FIXTURE_DIR); mkdirSync(output, { recursive: true });
      writeFileSync(resolve(output, `${locale}-${code}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`);
    }
    variants++;
  }
  for (const code of ["unknown", "constructor", "__proto__", "toString"]) {
    assert.equal(presentation.presentPublicJournalDetail(messages, locale, code), null);
    await assert.rejects(page.default({ params: Promise.resolve({ code }), searchParams: Promise.resolve({}) }), /FIXTURE_NOT_FOUND/);
    assert.equal(routing.publicLocaleRoute(`${locale === "ru" ? "" : `/${locale}`}/journals-info/${code}`), null);
  }
}
assert.deepEqual({ JOURNAL_INFO, JOURNAL_SEO }, original);
if (process.env.PUBLIC_DETAIL_EVIDENCE_DIR) {
  const output = resolve(process.env.PUBLIC_DETAIL_EVIDENCE_DIR); mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "consumer-check.json"), JSON.stringify({ status: staging ? "PASS_STAGED_FIXTURE_ONLY" : "PASS_INSTALLED_FIXTURE", variants, metadataCases, faqItems, guideCases,
    deferred: ["download dialog", "Russian screenshots", "PDF/DOCX language", "live application/DB"] }, null, 2) + "\n");
}
assert.equal(variants, 135);
assert.equal(metadataCases, 135);
});

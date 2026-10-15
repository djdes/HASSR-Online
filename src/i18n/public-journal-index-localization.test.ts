/* eslint-disable react/no-children-prop -- Typed fixture provider requires children in props. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, relative, dirname } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createTranslator } from "use-intl/core";
import { SiteLocaleProvider } from "@/components/i18n/site-locale-provider";
import { JOURNAL_INFO } from "@/content/journal-info";
import { NICHES } from "@/content/niches";
import { SEO_LANDINGS } from "@/content/seo-landings";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { SAMPLE_JOURNAL_CODES } from "@/lib/journal-sample-fixtures";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import type * as Routing from "@/i18n/site-locale";
import type * as Presentation from "@/i18n/public-journal-index-presentation";
import type { Metadata } from "next";

const stagingRoot = process.env.PUBLIC_INDEX_SOURCE_ROOT;
const sourceFile = (path: string) => stagingRoot && existsSync(resolve(stagingRoot, path)) ? resolve(stagingRoot, path) : resolve(path);
const text = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const locales = ["ru", "en", "uz"] as const;
async function messagesFor(locale: Locale) {
  const messages = await loadMessages(locale);
  return process.env.PUBLIC_INDEX_CATALOG_ROOT
    ? { ...messages, ...JSON.parse(readFileSync(resolve(process.env.PUBLIC_INDEX_CATALOG_ROOT, `${locale}.json`), "utf8")) } as typeof messages
    : messages;
}

/** Execute actual staged or installed modules. Only server I/O and public shared chrome are mocked. */
function fixture(locale: Locale, extra: Record<string, unknown> = {}) {
  const cache = new Map<string, { exports: unknown }>();
  const owned = new Set([
    "src/app/journals-info/page.tsx", "src/app/en/journals-info/page.tsx", "src/app/uz/journals-info/page.tsx",
    "src/i18n/site-locale.ts", "src/i18n/public-journal-detail-codes.ts", "src/i18n/public-journal-index-metadata.ts", "src/i18n/public-journal-index-presentation.ts",
    "src/components/i18n/localized-link.tsx",
  ]);
  const mocks: Record<string, unknown> = {
    "@/i18n/site-locale-server": { getSiteLocale: async () => locale },
    "@/components/public/public-chrome": { PublicHeader: () => null, PublicFooter: () => null },
    "@/i18n/messages": { loadMessages: messagesFor }, "./messages": { loadMessages: messagesFor },
    ...extra,
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
        const candidate = id.startsWith("@/") ? resolve("src", id.slice(2)) : id.startsWith(".") ? resolve(dirname(absolute), id) : undefined;
        if (candidate) for (const extension of [".ts", ".tsx"]) {
          const local = relative(process.cwd(), candidate + extension).replaceAll("\\", "/");
          if (owned.has(local)) return actual(local);
        }
        const resolved = require.resolve(id);
        const local = relative(process.cwd(), resolved).replaceAll("\\", "/");
        return owned.has(local) ? actual(local) : require(id);
      },
    }, { filename: sourceFile(path) });
    return compiled.exports as T;
  }
  return actual;
}

test("actual index renders all 45 cards, source ordering, 14 niche and 7 SEO links in three locales", async () => {
  const original = structuredClone({ JOURNAL_INFO, NICHES, SEO_LANDINGS });
  for (const locale of locales) {
    const actual = fixture(locale), messages = await messagesFor(locale);
    const routing = actual<typeof Routing>("src/i18n/site-locale.ts");
    const projection = actual<typeof Presentation>("src/i18n/public-journal-index-presentation.ts").presentPublicJournalIndex(messages);
    const page = actual<{ default: () => Promise<ReactNode> }>("src/app/journals-info/page.tsx");
    const html = renderToStaticMarkup(createElement(SiteLocaleProvider, { locale, messages, timeZone: "UTC", children: await page.default() }));
    const t = createTranslator({ locale, messages, namespace: "publicJournalIndex" });
    assert.ok(html.includes(text(t("hero.title", { count: 45 }))));
    assert.equal(projection.count, 45);
    assert.deepEqual(Array.from(projection.grouped, group => group.items.length), [14, 5, 26]);
    assert.equal((html.match(/href="\/(?:en\/|uz\/)?journals-info\//g) ?? []).length, 45);
    let last = -1;
    for (const group of projection.grouped) {
      assert.ok(html.includes(text(group.label)));
      assert.ok(html.includes(text(t("cards.groupCount", { count: group.items.length }))));
      for (const item of group.items) {
        const position = html.indexOf(`href="${routing.localizedHref(`/journals-info/${item.code}`, locale)}"`);
        assert.ok(position > last); last = position;
        assert.ok(html.includes(text(item.tagline))); assert.ok(html.includes(text(item.why)));
        assert.ok(html.includes(`title="${text(item.name)}"`));
        assert.equal(html.includes(`src="/journal-samples/${item.code}.webp"`), SAMPLE_JOURNAL_CODES.includes(item.code as typeof SAMPLE_JOURNAL_CODES[number]));
      }
    }
    for (const item of projection.niches) {
      assert.ok(html.includes(`href="/${item.slug}"`)); assert.ok(html.includes(text(item.audience)));
    }
    for (const item of projection.seo) {
      assert.ok(html.includes(`href="/${item.slug}"`)); assert.ok(html.includes(text(item.hero)));
    }
    for (const path of ["/blanki", "/register"]) assert.ok(html.includes(`href="${routing.localizedHref(path, locale)}"`));
    if (locale !== "ru") assert.ok(!/[А-Яа-яЁё]/u.test(html), `${locale}: no Russian index text (raster content excluded)`);
    if (process.env.PUBLIC_INDEX_FIXTURE_DIR) {
      mkdirSync(process.env.PUBLIC_INDEX_FIXTURE_DIR, { recursive: true });
      writeFileSync(resolve(process.env.PUBLIC_INDEX_FIXTURE_DIR, `${locale}-index.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`);
    }
  }
  assert.deepEqual({ JOURNAL_INFO, NICHES, SEO_LANDINGS }, original);
});

test("source provenance and future unmapped journal/link coverage fail closed", async () => {
  const messages = await messagesFor("ru");
  const copy = messages.publicJournalIndex;
  assert.deepEqual(Object.keys(copy.descriptions).sort(), Object.keys(JOURNAL_INFO).sort());
  assert.deepEqual(Object.keys(copy.nicheLinks).sort(), Object.values(NICHES).map(item => item.slug).sort());
  assert.deepEqual(Object.keys(copy.seoLinks), Object.values(SEO_LANDINGS).slice(0, 7).map(item => item.slug));
  for (const source of Object.values(JOURNAL_INFO)) {
    const code = source.code as keyof typeof copy.descriptions;
    assert.equal(copy.descriptions[code], source.why);
    assert.equal(messages.journalInfoTaglines[code], source.tagline);
    assert.equal(messages.journals.names[code], ACTIVE_JOURNAL_CATALOG.find(item => item.code === code)?.name);
  }
  for (const [moduleName, replacement] of [
    ["@/content/journal-info", { JOURNAL_INFO: { unknown: { ...JOURNAL_INFO.hygiene, code: "unknown" } } }],
    ["@/content/niches", { NICHES: { unknown: { slug: "unknown", audience: "Customer original" } } }],
    ["@/content/seo-landings", { SEO_LANDINGS: { unknown: { slug: "unknown", hero: "Customer original" } } }],
  ] as const) {
    const actual = fixture("ru", { [moduleName]: replacement });
    assert.throws(() => actual<typeof Presentation>("src/i18n/public-journal-index-presentation.ts").presentPublicJournalIndex(messages), /Unmapped public journal/);
  }
});

test("actual index aliases, metadata and sitemap include translated detail routes and preserve unrelated routes", async () => {
  const actual = fixture("ru");
  const routing = actual<typeof Routing>("src/i18n/site-locale.ts");
  for (const locale of locales) {
    const path = routing.localizedHref("/journals-info", locale);
    const request = new Request(`https://wesetup.ru${path}`, { headers: { cookie: "wesetup.site-locale=en" } });
    assert.equal(routing.resolveRequestLocale(request, { authenticated: true, userLocale: "uz", organizationLocale: "en" }), locale);
    assert.equal(routing.localizedHref("/journals-info?q=1#catalog", locale), `${path}?q=1#catalog`);
    assert.equal(routing.localizedHref("/features/qr?q=1#steps", locale), `${locale === "ru" ? "" : `/${locale}`}/features/qr?q=1#steps`);
    for (const unchanged of ["/blanki?code=hygiene", "/api/journal-samples/hygiene/pdf?inline=1#toolbar=0", "/dlya-kafe", "/zhurnal-haccp", "/journals/hygiene"]) assert.equal(routing.localizedHref(unchanged, locale), unchanged);
    assert.equal(routing.localizedHref("/journals-info/hygiene?download=pdf#preview", locale), `${locale === "ru" ? "" : `/${locale}`}/journals-info/hygiene?download=pdf#preview`);
    assert.deepEqual(Array.from(routing.publicLocalesForPath("/journals-info/hygiene")), ["ru", "en", "uz"]);
    const pageModule = fixture(locale)<{ default: () => Promise<ReactNode>; generateMetadata: () => Promise<Metadata> }>(`src/app/${locale === "ru" ? "" : `${locale}/`}journals-info/page.tsx`);
    assert.equal(typeof pageModule.default, "function");
    const meta = await pageModule.generateMetadata();
    const messages = await messagesFor(locale);
    const t = createTranslator({ locale, messages, namespace: "publicJournalIndex.metadata" });
    assert.equal(meta.title, t("title", { count: 45 })); assert.equal(meta.description, t("description", { count: 45 }));
    assert.equal(meta.alternates?.canonical, `https://wesetup.ru${path}`);
    assert.deepEqual(JSON.parse(JSON.stringify(meta.alternates?.languages)), JSON.parse(JSON.stringify(routing.siteLanguageAlternates("/journals-info"))));
    const og = meta.openGraph as { locale: string; url: string; images: Array<{ url: string }> };
    assert.equal(og.locale, { ru: "ru_RU", en: "en_GB", uz: "uz_UZ" }[locale]);
    assert.equal(og.url, `https://wesetup.ru${path}`);
    assert.equal(new URL(og.images[0].url).searchParams.get("l"), locale);
    assert.equal(new URL((meta.twitter?.images as string[])[0]).searchParams.get("l"), locale);
  }
  let calls = 0;
  const sitemap = fixture("ru", {
    "@/lib/db": { db: { article: { findMany: async () => { calls++; return []; } } } },
    "@/components/landing/niche-landing": { NICHES }, "@/components/landing/seo-journal-landing": { SEO_LANDINGS },
  })<{ default: () => Promise<Array<{ url: string; alternates?: { languages: Record<string, string> } }>> }>("src/app/sitemap.ts");
  const entries = (await sitemap.default()).filter(item => /\/(?:en\/|uz\/)?journals-info(?:\/|$)/.test(item.url));
  assert.equal(calls, 1); assert.equal(entries.length, 138);
  for (const locale of locales) {
    const entry = entries.find(item => item.url === `https://wesetup.ru${routing.localizedHref("/journals-info", locale)}`);
    assert.ok(entry); assert.deepEqual(JSON.parse(JSON.stringify(entry.alternates?.languages)), JSON.parse(JSON.stringify(routing.siteLanguageAlternates("/journals-info"))));
  }
  for (const code of Object.keys(JOURNAL_INFO)) for (const locale of locales) {
    const path = `/journals-info/${code}`;
    const entry = entries.find(item => item.url === `https://wesetup.ru${routing.localizedHref(path, locale)}`);
    assert.ok(entry);
    assert.deepEqual(JSON.parse(JSON.stringify(entry.alternates?.languages)), JSON.parse(JSON.stringify(routing.siteLanguageAlternates(path))));
  }
});

test("actual server locale resolution prioritizes the explicit index alias without loading personal preferences", async () => {
  for (const locale of locales) {
    let sessionReads = 0, cookieReads = 0;
    const pathname = `${locale === "ru" ? "" : `/${locale}`}/journals-info`;
    const actual = fixture(locale, {
      "server-only": {},
      "next/headers": {
        headers: async () => ({ get: () => pathname }),
        cookies: async () => { cookieReads++; return { get: () => ({ value: "uz" }) }; },
      },
      "@/lib/server-session": { getServerSession: async () => { sessionReads++; return { user: { locale: "en", organizationLocale: "uz" } }; } },
      "@/lib/auth": { authOptions: {} },
    });
    const server = actual<{ getSiteLocale: () => Promise<Locale> }>("src/i18n/site-locale-server.ts");
    assert.equal(await server.getSiteLocale(), locale);
    assert.equal(sessionReads, 0); assert.equal(cookieReads, 0);
  }
});

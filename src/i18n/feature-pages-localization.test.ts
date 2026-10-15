/* eslint-disable react/no-children-prop -- Typed createElement providers require children in props in this .ts fixture. */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createTranslator } from "use-intl/core";
import { SiteLocaleProvider } from "@/components/i18n/site-locale-provider";
import { FEATURES_INFO, FEATURES_ORDER } from "@/content/features";
import { JOURNALS_TOTAL } from "@/lib/journal-catalog";
import { presentFeature } from "./feature-presentation";
import { loadMessages } from "./messages";
import { localizedHref, resolveRequestLocale, siteLanguageAlternates } from "./site-locale";
import type { Locale } from "./locales";

const htmlText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

function saveFixture(locale: Locale, name: string, html: string) {
  if (!process.env.FEATURE_FIXTURE_DIR) return;
  mkdirSync(process.env.FEATURE_FIXTURE_DIR, { recursive: true });
  writeFileSync(`${process.env.FEATURE_FIXTURE_DIR}/${locale}-${name}.html`, `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`);
}

function actualModule<T>(path: string, mocks: Record<string, unknown>): T {
  const require = createRequire(import.meta.url), compiled = { exports: {} };
  const source = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { module: compiled, exports: compiled.exports, URL, Date,
    require: (id: string) => Object.hasOwn(mocks, id) ? mocks[id] : require(id),
  });
  return compiled.exports as T;
}

test("actual feature index and all nine detail pages render translated body, destinations and matching breadcrumb data", async () => {
  const original = structuredClone(FEATURES_INFO);
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const mocks = {
      "@/i18n/site-locale-server": { getSiteLocale: async () => locale },
      "@/components/public/public-chrome": { PublicHeader: () => null, PublicFooter: () => null },
      "next/navigation": { notFound: () => { throw new Error("FIXTURE_NOT_FOUND"); } },
    };
    const render = (element: ReactNode) => renderToStaticMarkup(createElement(SiteLocaleProvider, { locale, messages, timeZone: "UTC", children: element }));
    const index = actualModule<{ default: () => Promise<ReactNode> }>("src/app/features/page.tsx", mocks);
    const indexHtml = render(await index.default());
    saveFixture(locale, "index", indexHtml);
    const t = createTranslator({ locale, messages, namespace: "publicFeatures.index" });
    assert.ok(indexHtml.includes(htmlText(t("title"))));
    assert.ok(indexHtml.includes(htmlText(t("catalogDescription", { journalCount: JOURNALS_TOTAL }))));
    for (const slug of FEATURES_ORDER) {
      assert.ok(indexHtml.includes(`href="${localizedHref(`/features/${slug}`, locale)}"`));
      assert.ok(indexHtml.includes(htmlText(messages.publicFeatures.features[slug as keyof typeof messages.publicFeatures.features].title)));
    }
    for (const path of ["/register", "/journals-info"]) assert.ok(indexHtml.includes(`href="${localizedHref(path, locale)}"`));
    const detail = actualModule<{ default: (input: { params: Promise<{ slug: string }> }) => Promise<ReactNode> }>("src/app/features/[slug]/page.tsx", mocks);
    for (const slug of FEATURES_ORDER) {
      const html = render(await detail.default({ params: Promise.resolve({ slug }) }));
      const shown = presentFeature(slug as keyof typeof messages.publicFeatures.features, messages);
      assert.ok(html.includes(htmlText(shown.title)));
      assert.ok(html.includes(htmlText(shown.tagline)));
      for (const block of shown.body) {
        if ("text" in block) assert.ok(html.includes(htmlText(block.text)), `${locale}/${slug}: body text`);
        if (block.type === "ul" || block.type === "ol") for (const item of block.items) assert.ok(html.includes(htmlText(item)));
        if (block.type === "callout" && block.title) assert.ok(html.includes(htmlText(block.title)));
      }
      assert.ok(html.includes(`aria-label="${htmlText(messages.publicFeatures.detail.breadcrumbAria)}"`));
      const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      assert.ok(script);
      const crumbs = JSON.parse(script[1]).itemListElement;
      assert.deepEqual(crumbs.map((item: { name: string }) => item.name), [messages.publicFeatures.detail.home, messages.publicFeatures.detail.breadcrumb, shown.title]);
      assert.equal(crumbs[0].item, `https://wesetup.ru${localizedHref("/", locale)}`);
      assert.equal(crumbs[1].item, `https://wesetup.ru${localizedHref("/features", locale)}`);
      assert.equal(crumbs[2].item, undefined);
      for (const other of FEATURES_ORDER.filter(value => value !== slug).slice(0, 4)) assert.ok(html.includes(`href="${localizedHref(`/features/${other}`, locale)}"`));
      if (locale !== "ru") assert.ok(!/[А-Яа-яЁё]/u.test(html), `${locale}/${slug}: no Russian application text`);
      saveFixture(locale, slug, html);
    }
    for (const slug of ["missing", "constructor", "__proto__", "toString"]) await assert.rejects(detail.default({ params: Promise.resolve({ slug }) }), /FIXTURE_NOT_FOUND/);
  }
  assert.deepEqual(FEATURES_INFO, original);
});

test("feature aliases, request locale and actual sitemap expose exactly the same three-language routes", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    for (const slug of [undefined, ...FEATURES_ORDER]) {
      const path = slug ? `/features/${slug}` : "/features";
      const url = localizedHref(path, locale);
      const request = new Request(`https://wesetup.ru${url}`, { headers: { cookie: "wesetup.site-locale=en" } });
      assert.equal(resolveRequestLocale(request, { authenticated: true, userLocale: "uz", organizationLocale: "en" }), locale);
    }
    if (locale !== "ru") for (const tail of ["page.tsx", "[slug]/page.tsx"]) {
      const wrapper = readFileSync(`src/app/${locale}/features/${tail}`, "utf8");
      assert.match(wrapper, /export\s*\{\s*default,\s*generateMetadata\s*\}/);
    }
  }
  let calls = 0;
  const sitemap = actualModule<{ default: () => Promise<Array<{ url: string; alternates?: { languages: Record<string, string> } }>> }>("src/app/sitemap.ts", {
    "@/lib/db": { db: { article: { findMany: async () => { calls++; return []; } } } },
    "@/components/landing/niche-landing": { NICHES: {} },
    "@/components/landing/seo-journal-landing": { SEO_LANDINGS: {} },
  });
  const entries = (await sitemap.default()).filter(page => /\/(?:en\/|uz\/)?features(?:\/|$)/.test(page.url));
  assert.equal(calls, 1); assert.equal(entries.length, (FEATURES_ORDER.length + 1) * 3);
  assert.equal(new Set(entries.map(page => page.url)).size, entries.length);
  for (const path of ["/features", ...FEATURES_ORDER.map(slug => `/features/${slug}`)]) {
    for (const locale of ["ru", "en", "uz"] as Locale[]) {
      const page = entries.find(page => page.url === `https://wesetup.ru${localizedHref(path, locale)}`);
      assert.ok(page); assert.deepEqual(JSON.parse(JSON.stringify(page.alternates?.languages)), siteLanguageAlternates(path));
    }
  }
});

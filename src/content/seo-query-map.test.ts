import assert from "node:assert/strict";
import test from "node:test";

import { COMPARISONS } from "@/content/comparisons";
import { FEATURES_INFO } from "@/content/features";
import { GLOSSARY } from "@/content/glossary";
import { JOURNAL_SEO } from "@/content/journal-seo";
import { KB_ARTICLES } from "@/content/kb/articles";
import { NICHES } from "@/content/niches";
import { MERGED_SEO_LANDINGS, SEO_LANDINGS } from "@/content/seo-landings";
import { SEO_REDIRECTS } from "@/content/seo-redirects";
import { readSeedArticles } from "../../scripts/lib/read-seed-articles";

/**
 * Один запрос — одна страница (спека seo-speed-pack-2026-11, п. 12). Главный
 * запрос страницы — начало её title до двоеточия/тире. Две страницы с одним и
 * тем же началом спорят в выдаче; тест ловит такое при добавлении новых.
 */

const STOP = new Set(["и", "в", "на", "для", "по", "с", "о", "как", "что", "это"]);

/** «Журнал уборки помещений: бланк» → «журнал уборки помеще» (первые три значимых слова, основы). */
function queryKey(title: string): string {
  const head = title.split(/\s[—–-]\s|:/)[0];
  return head
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"()]/g, " ")
    .split(/[^a-zа-я0-9.]+/i)
    .filter((word) => word && !STOP.has(word))
    .slice(0, 3)
    .map((word) => word.slice(0, 6))
    .join(" ");
}

test("каждый главный запрос — у одной страницы", async () => {
  const pages: Array<{ url: string; title: string }> = [];
  for (const [code, seo] of Object.entries(JOURNAL_SEO)) pages.push({ url: `/journals-info/${code}`, title: seo.title });
  for (const landing of Object.values(SEO_LANDINGS)) pages.push({ url: `/${landing.slug}`, title: landing.metaTitle });
  for (const niche of Object.values(NICHES)) pages.push({ url: `/${niche.slug}`, title: niche.metaTitle });
  for (const term of GLOSSARY) pages.push({ url: `/glossary/${term.slug}`, title: `${term.term}: что это` });
  for (const [slug, feature] of Object.entries(FEATURES_INFO)) pages.push({ url: `/features/${slug}`, title: feature.title });
  for (const comparison of Object.values(COMPARISONS)) pages.push({ url: `/compare/${comparison.slug}`, title: comparison.title });
  for (const article of KB_ARTICLES) pages.push({ url: `/baza-znaniy/${article.slug}`, title: article.title });
  for (const article of await readSeedArticles()) pages.push({ url: `/blog/${article.slug}`, title: article.title });

  const byKey = new Map<string, string[]>();
  for (const page of pages) {
    const key = queryKey(page.title);
    byKey.set(key, [...(byKey.get(key) ?? []), `${page.url} «${page.title}»`]);
  }
  const clashes = [...byKey.entries()].filter(([, urls]) => urls.length > 1);
  assert.deepEqual(clashes, [], `страницы спорят за один запрос:\n${clashes.map(([key, urls]) => `${key}: ${urls.join(" | ")}`).join("\n")}`);
});

test("слитые адреса не остаются страницами и ведут на живые", () => {
  for (const [from, to] of Object.entries(SEO_REDIRECTS)) {
    assert.ok(!Object.hasOwn(SEO_REDIRECTS, to), `${from} → ${to}: цепочка редиректов`);
    assert.ok(!Object.values(SEO_LANDINGS).some((landing) => `/${landing.slug}` === from), `${from}: лендинг ещё живой`);
    assert.ok(!GLOSSARY.some((term) => `/glossary/${term.slug}` === from), `${from}: термин ещё в глоссарии`);
  }
  for (const landing of Object.values(MERGED_SEO_LANDINGS)) {
    assert.ok(Object.hasOwn(SEO_REDIRECTS, `/${landing.slug}`), `/${landing.slug}: слит, но без редиректа`);
  }
});

test("title и description страниц журналов — по длине для выдачи", () => {
  for (const [code, seo] of Object.entries(JOURNAL_SEO)) {
    assert.ok(`${seo.title} — WeSetup`.length <= 60, `${code}: title ${seo.title.length + 10} > 60`);
    assert.ok(seo.description.length >= 70 && seo.description.length <= 160, `${code}: description ${seo.description.length}`);
  }
});

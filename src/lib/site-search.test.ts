import assert from "node:assert/strict";
import test from "node:test";

import { buildSiteSearchIndex } from "@/lib/site-search-index.server";
import { flattenSiteSearch, searchSite, shortDescription, siteSearchScore, type SiteSearchItem } from "@/lib/site-search";

/** Поиск по сайту (спека site-search-2026-11). */

const items: SiteSearchItem[] = [
  { kind: "blog", title: "Журнал уборки: что писать", description: "Статья о текущей и генеральной уборке", href: "/blog/uborka" },
  { kind: "journal", title: "Журнал уборки помещений", description: "Ежедневная уборка цехов", href: "/journals-info/cleaning", keywords: "cleaning" },
  { kind: "journal", title: "Гигиенический журнал (сотрудники)", description: "Осмотр перед сменой", href: "/journals-info/hygiene", keywords: "hygiene" },
  { kind: "order", title: "Приказ о назначении ответственного за уборку", description: "", href: "/prikazy#cleaning_resp" },
  { kind: "page", title: "Тарифы", description: "", href: "/pricing", keywords: "цены стоимость" },
];

test("ранжирование: журнал выше статьи с тем же словом; совпадение с начала названия — первым", () => {
  const groups = searchSite(items, "журнал уборки");
  assert.equal(groups[0].kind, "journal");
  assert.equal(flattenSiteSearch(groups)[0].href, "/journals-info/cleaning");
  assert.ok(siteSearchScore(items[1], "журнал") > siteSearchScore(items[0], "журнал"), "вес вида при равном совпадении");
});

test("опечатки, падежи, неверная раскладка и скрытые слова", () => {
  assert.equal(flattenSiteSearch(searchSite(items, "гигена"))[0]?.href, "/journals-info/hygiene", "опечатка");
  assert.equal(flattenSiteSearch(searchSite(items, "ububtyf"))[0]?.href, "/journals-info/hygiene", "раскладка");
  assert.equal(flattenSiteSearch(searchSite(items, "стоимость"))[0]?.href, "/pricing", "скрытые слова");
  assert.equal(flattenSiteSearch(searchSite(items, "cleaning"))[0]?.href, "/journals-info/cleaning", "код журнала");
  assert.deepEqual(searchSite(items, "абракадабра"), []);
  assert.deepEqual(searchSite(items, "   "), []);
});

test("группы ограничены по размеру и общему числу", () => {
  const many = Array.from({ length: 20 }, (_, i): SiteSearchItem => ({ kind: "blog", title: `Уборка ${i}`, description: "", href: `/blog/${i}` }));
  const groups = searchSite(many, "уборка", { perGroup: 6, limit: 30 });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 6);
});

test("короткое описание не рвёт слово", () => {
  assert.equal(shortDescription("коротко"), "коротко");
  const long = shortDescription("слово ".repeat(60), 40);
  assert.ok(long.endsWith("…") && long.length <= 41 && !long.includes("сло…"));
});

test("индекс собирается из журналов, бланков, приказов, базы знаний и разделов; ссылки локализуются", async () => {
  const ru = await buildSiteSearchIndex("ru");
  const kinds = new Set(ru.map((item) => item.kind));
  for (const kind of ["journal", "blank", "order", "kb", "glossary", "feature", "page"]) assert.ok(kinds.has(kind as SiteSearchItem["kind"]), kind);
  assert.ok(ru.some((item) => item.href === "/journals-info/cleaning"));
  assert.ok(ru.some((item) => item.href.startsWith("/blanki?download=pdf&paper=")));
  assert.ok(ru.some((item) => item.href.startsWith("/prikazy#")));
  assert.ok(ru.every((item) => item.href.startsWith("/") && item.title.trim()));
  assert.equal(flattenSiteSearch(searchSite(ru, "журнал уборки"))[0]?.href, "/journals-info/cleaning");
  assert.equal(flattenSiteSearch(searchSite(ru, "уборк"))[0]?.href, "/journals-info/cleaning", "короткое точное название — первым");
  const en = await buildSiteSearchIndex("en");
  assert.ok(en.some((item) => item.href === "/en/journals-info/cleaning"), "английские ссылки с префиксом");
});

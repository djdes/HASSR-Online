import type { SiteLocale } from "@/i18n/site-locale";
import { localizedHref } from "@/i18n/site-locale";
import { loadMessages } from "@/i18n/messages";
import { publishedArticleWhere } from "@/lib/article-visibility";
import { COMPARISONS } from "@/content/comparisons";
import { FEATURES_INFO } from "@/content/features";
import { GLOSSARY } from "@/content/glossary";
import { JOURNAL_INFO } from "@/content/journal-info";
import { KB_ARTICLES } from "@/content/kb/articles";
import { NICHES } from "@/content/niches";
import { SEO_LANDINGS } from "@/content/seo-landings";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { ORDER_TEMPLATES } from "@/lib/orders/catalog";
import { shortDescription, type SiteSearchItem } from "@/lib/site-search";
import { PAPER_JOURNALS } from "@/lib/sphere-journal-rules";

/**
 * Индекс поиска по сайту (спека site-search-2026-11): всё публичное, что
 * человек может искать, — одним списком. Собирается из тех же источников,
 * что и сами страницы, поэтому новый журнал, статья или приказ попадают в
 * поиск без отдельной правки. Кешируется на 10 минут на язык.
 */

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<SiteLocale, { at: number; items: SiteSearchItem[] }>();

type Names = Record<string, string>;

/** Описание по смыслу совпадает с названием (без регистра, «ё», точки на конце). */
function sameText(a: string | null | undefined, b: string): boolean {
  const norm = (value: string) => value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[.\s]+$/, "").replace(/\s+/g, " ").trim();
  const left = norm(a ?? "");
  const right = norm(b);
  return !left || right.includes(left) || left.includes(right);
}

export async function buildSiteSearchIndex(locale: SiteLocale): Promise<SiteSearchItem[]> {
  const messages = await loadMessages(locale);
  const chrome = messages.publicChrome as unknown as Record<string, string>;
  const names = messages.journals.names as unknown as Names;
  const href = (path: string) => localizedHref(path, locale);
  const items: SiteSearchItem[] = [];

  // Журналы каталога: название на языке сайта, описание — зачем журнал.
  for (const journal of ACTIVE_JOURNAL_CATALOG) {
    const info = JOURNAL_INFO[journal.code];
    const title = names[journal.code] ?? journal.name;
    items.push({
      kind: "journal",
      title,
      // Описание, повторяющее название, ничего не добавляет — тогда «зачем журнал».
      description: shortDescription(sameText(info?.tagline, title) ? info?.why : info?.tagline),
      href: href(`/journals-info/${journal.code}`),
      keywords: [journal.code, journal.name, info?.why, ...(info?.normative ?? []).map((n) => n.title)].filter(Boolean).join(" "),
    });
  }

  // Посадочные страницы журналов («Журнал уборки», «Бракеражный журнал»).
  for (const landing of Object.values(SEO_LANDINGS)) {
    items.push({
      kind: "page",
      title: landing.navLabel,
      description: shortDescription(landing.metaDescription),
      href: href(`/${landing.slug}`),
      keywords: [landing.hero, ...(landing.keywords ?? [])].join(" "),
    });
  }

  // Бумажные бланки — ссылка сразу открывает окно скачивания.
  for (const paper of PAPER_JOURNALS) {
    items.push({
      kind: "blank",
      title: paper.name,
      description: shortDescription(paper.why),
      href: href(`/blanki?download=pdf&paper=${encodeURIComponent(paper.id)}`),
      keywords: `бланк pdf ${paper.id}`,
    });
  }

  for (const order of ORDER_TEMPLATES) {
    items.push({
      kind: "order",
      title: `Приказ ${order.title.charAt(0).toLowerCase()}${order.title.slice(1)}`,
      description: shortDescription(order.purpose),
      href: href(`/prikazy#${order.code}`),
      keywords: [order.code, ...order.basis].join(" "),
    });
  }

  for (const article of KB_ARTICLES) {
    items.push({ kind: "kb", title: article.title, description: shortDescription(article.lead), href: href(`/baza-znaniy/${article.slug}`) });
  }

  for (const term of GLOSSARY) {
    items.push({ kind: "glossary", title: term.term, description: shortDescription(term.short), href: href(`/glossary/${term.slug}`) });
  }

  for (const [slug, feature] of Object.entries(FEATURES_INFO)) {
    items.push({ kind: "feature", title: feature.title, description: shortDescription(feature.tagline), href: href(`/features/${slug}`) });
  }

  for (const niche of Object.values(NICHES)) {
    items.push({
      kind: "page",
      title: niche.metaTitle.split(/[|—–]/)[0].trim() || niche.navLabel,
      description: shortDescription(niche.metaDescription),
      href: href(`/${niche.slug}`),
      keywords: `${niche.navLabel} ${niche.audience}`,
    });
  }

  for (const comparison of Object.values(COMPARISONS)) {
    items.push({
      kind: "page",
      title: comparison.title,
      description: shortDescription(comparison.metaDescription),
      href: href(`/compare/${comparison.slug}`),
      keywords: comparison.rival,
    });
  }

  // Разделы сайта — подписи те же, что в меню и подвале.
  const sections: Array<[string, string, string]> = [
    [chrome.journals, "/journals-info", "каталог журналов санпин хассп"],
    [chrome.forms, "/blanki", "бланки pdf печать распечатать"],
    [chrome.orders, "/prikazy", "приказы образцы"],
    [chrome.blog, "/blog", "статьи"],
    [chrome.knowledgeBase, "/baza-znaniy", "инструкция помощь как"],
    [chrome.pricing, "/pricing", "тарифы цены стоимость оплата"],
    [chrome.journalCalculator, "/calc/journals", "какие журналы нужны калькулятор"],
    [chrome.fineCalculator, "/calc/fines", "штрафы калькулятор роспотребнадзор"],
    [chrome.sanpin4282, "/sanpin-2-3-2-4-4282-26", "санпин 2026 требования"],
    [chrome.autofillOffer, "/avtozapolnenie", "автозаполнение"],
    [chrome.services, "/uslugi", "услуги разработка ппк хассп"],
    [chrome.glossary, "/glossary", "термины словарь"],
    [chrome.comparisons, "/compare", "сравнение конкуренты"],
    [chrome.partners, "/partners", "партнёрская программа"],
    [chrome.whatsNew, "/whats-new", "обновления новое"],
    [chrome.developers, "/developers", "api интеграция"],
    [chrome.register, "/register", "регистрация попробовать бесплатно"],
    [chrome.login, "/login", "вход войти кабинет"],
  ];
  for (const [title, path, keywords] of sections) {
    if (title) items.push({ kind: "page", title, description: "", href: href(path), keywords });
  }

  // Блог — из базы (опубликованные статьи). Сбой базы не ломает поиск.
  const articles = await db.article
    .findMany({
      where: publishedArticleWhere(new Date()),
      orderBy: { publishedAt: "desc" },
      select: { slug: true, title: true, excerpt: true },
      take: 500,
    })
    .catch((error) => {
      console.error("[site-search] articles load failed", error);
      return [] as Array<{ slug: string; title: string; excerpt: string }>;
    });
  for (const article of articles) {
    items.push({ kind: "blog", title: article.title, description: shortDescription(article.excerpt), href: href(`/blog/${article.slug}`) });
  }

  return items.filter((item) => item.title.trim() !== "");
}

/** Индекс из кеша (10 минут на язык). */
export async function siteSearchIndex(locale: SiteLocale): Promise<SiteSearchItem[]> {
  const hit = cache.get(locale);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items;
  const items = await buildSiteSearchIndex(locale);
  cache.set(locale, { at: Date.now(), items });
  return items;
}

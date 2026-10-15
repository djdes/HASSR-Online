import { createHash } from "node:crypto";
import { isArticleBlockArray, type ArticleBlock } from "./article-blocks";
import type { Locale } from "@/i18n/locales";

export type ArticleSource = {
  title: string;
  excerpt: string;
  body: unknown;
  tags: string[];
};

export type ArticleTranslationContent = ArticleSource & {
  locale: string;
  sourceHash: string;
};

// JSONB key ordering is not stable. Sort objects recursively, preserving array order.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

/** Content revision excludes publication/operational metadata and database timestamps. */
export function articleSourceHash(article: ArticleSource): string {
  return createHash("sha256").update(JSON.stringify(canonical({
    title: article.title, excerpt: article.excerpt, body: article.body, tags: article.tags,
  }))).digest("hex");
}

function shape(block: ArticleBlock): unknown {
  switch (block.type) {
    case "ul": case "ol": case "faq": return [block.type, block.items.length];
    case "quote": return [block.type, block.author]; // Attribution is a proper name.
    case "callout": return [block.type, block.tone, block.title !== undefined];
    default: return [block.type];
  }
}

function nonempty(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0 && !value.includes("\uFFFD");
  if (Array.isArray(value)) return value.every(nonempty);
  if (value && typeof value === "object") return Object.values(value).every(nonempty);
  return value === undefined;
}

/** Reject stale content, altered block structure and blank translations before display. */
export function isCurrentArticleTranslation(
  source: ArticleSource, translation: ArticleTranslationContent, locale: Locale,
): boolean {
  if (locale === "ru" || translation.locale !== locale || translation.sourceHash !== articleSourceHash(source)) return false;
  if (!isArticleBlockArray(source.body) || !isArticleBlockArray(translation.body)) return false;
  if (source.tags.length !== translation.tags.length) return false;
  if (!nonempty([translation.title, translation.excerpt, translation.body, translation.tags])) return false;
  return JSON.stringify(source.body.map(shape)) === JSON.stringify(translation.body.map(shape));
}

/** Never alter identifiers or persisted content; unavailable translations remain explicit. */
export function localizeArticle<T extends ArticleSource>(
  source: T, translations: readonly ArticleTranslationContent[], locale: Locale,
): T & { contentLocale: Locale; translationMissing: boolean; displayTags: string[] } {
  const translated = translations.find((item) => isCurrentArticleTranslation(source, item, locale));
  return {
    ...source,
    ...(translated ? { title: translated.title, excerpt: translated.excerpt, body: translated.body } : {}),
    displayTags: translated ? [...translated.tags] : [...source.tags],
    contentLocale: translated ? locale : "ru",
    translationMissing: locale !== "ru" && !translated,
  };
}

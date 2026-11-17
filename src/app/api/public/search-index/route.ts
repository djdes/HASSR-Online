import { NextResponse } from "next/server";

import { isLocale } from "@/i18n/locales";
import { siteSearchIndex } from "@/lib/site-search-index.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/public/search-index?locale=ru — индекс поиска по сайту
 * (`site-search-index.server.ts`). Окно «Поиск» скачивает его один раз и
 * ищет у себя. Только публичные данные; кеш браузера и CDN — 5 минут.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("locale");
  const locale = isLocale(raw) ? raw : "ru";
  const items = await siteSearchIndex(locale);
  return NextResponse.json(
    { locale, items },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=3600", "Content-Language": locale } },
  );
}

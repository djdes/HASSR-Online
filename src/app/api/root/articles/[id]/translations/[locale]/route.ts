import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { articleSourceHash, isCurrentArticleTranslation } from "@/lib/article-localization";
import { isArticleBlockArray } from "@/lib/article-blocks";
import { translatorFor } from "@/i18n/translator";
import { resolveLocale } from "@/i18n/locales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string; locale: string }> }) {
  const session = await requireRoot();
  const t = await translatorFor(resolveLocale({ authenticated: true, userLocale: session.user.locale, organizationLocale: session.user.organizationLocale }));
  const { id, locale } = await context.params;
  if (locale !== "en" && locale !== "uz") {
    return NextResponse.json({ code: "INVALID_LOCALE", error: t("blogChrome.apiErrors.invalidLocale") }, { status: 400 });
  }
  const source = await db.article.findUnique({ where: { id } });
  if (!source) return NextResponse.json({ code: "NOT_FOUND", error: t("blogChrome.apiErrors.notFound") }, { status: 404 });
  const translation = await db.articleTranslation.findUnique({ where: { articleId_locale: { articleId: id, locale } } });
  return NextResponse.json({ source, sourceHash: articleSourceHash(source), translation,
    current: translation ? isCurrentArticleTranslation(source, translation, locale) : false,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Root-managed content only; translations never mutate the original article. */
export async function PUT(request: Request, context: { params: Promise<{ id: string; locale: string }> }) {
  const session = await requireRoot();
  const t = await translatorFor(resolveLocale({ authenticated: true, userLocale: session.user.locale, organizationLocale: session.user.organizationLocale }));
  const origin = request.headers.get("origin");
  const allowedOrigins = [new URL(request.url).origin];
  if (process.env.NEXTAUTH_URL) allowedOrigins.push(new URL(process.env.NEXTAUTH_URL).origin);
  if (origin && !allowedOrigins.includes(origin)) {
    return NextResponse.json({ code: "FORBIDDEN", error: t("blogChrome.apiErrors.forbidden") }, { status: 403 });
  }
  const { id, locale } = await context.params;
  if (locale !== "en" && locale !== "uz") {
    return NextResponse.json({ code: "INVALID_LOCALE", error: t("blogChrome.apiErrors.invalidLocale") }, { status: 400 });
  }
  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ code: "INVALID_TRANSLATION", error: t("blogChrome.apiErrors.invalidTranslation") }, { status: 400 });
  }
  const data = payload as Record<string, unknown>;
  if (typeof data.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(data.sourceHash)
    || typeof data.title !== "string" || typeof data.excerpt !== "string"
    || !Array.isArray(data.tags) || !data.tags.every((tag): tag is string => typeof tag === "string")
    || !isArticleBlockArray(data.body)) {
    return NextResponse.json({ code: "INVALID_TRANSLATION", error: t("blogChrome.apiErrors.invalidTranslation") }, { status: 400 });
  }
  const source = await db.article.findUnique({ where: { id } });
  if (!source) return NextResponse.json({ code: "NOT_FOUND", error: t("blogChrome.apiErrors.notFound") }, { status: 404 });
  if (data.sourceHash !== articleSourceHash(source)) {
    return NextResponse.json({ code: "STALE_TRANSLATION", error: t("blogChrome.apiErrors.staleTranslation") }, { status: 409 });
  }
  const content = { locale, sourceHash: data.sourceHash, title: data.title, excerpt: data.excerpt, tags: data.tags, body: data.body };
  if (!isCurrentArticleTranslation(source, content, locale)) {
    return NextResponse.json({ code: "INVALID_TRANSLATION", error: t("blogChrome.apiErrors.invalidStructure") }, { status: 400 });
  }
  // A concurrent source edit can make this revision stale; display validation always
  // compares the hash again, so such a translation can never replace newer content.
  const translation = await db.articleTranslation.upsert({
    where: { articleId_locale: { articleId: id, locale } },
    create: { articleId: id, ...content }, update: content,
  });
  return NextResponse.json({ translation }, { headers: { "Cache-Control": "private, no-store" } });
}

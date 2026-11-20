import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isArticleBlockArray } from "@/lib/article-blocks";
import { announceArticleIfPublished, articlePublishState } from "@/lib/blog-announce";
import { refreshPromoDataset } from "@/lib/promo-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await requireRoot();
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  const src = body as Record<string, unknown>;

  if (typeof src.slug === "string" && src.slug) data.slug = src.slug;
  if (typeof src.title === "string") data.title = src.title;
  if (typeof src.excerpt === "string") data.excerpt = src.excerpt;
  if ("coverIcon" in src) {
    data.coverIcon = typeof src.coverIcon === "string" ? src.coverIcon : null;
  }
  if (Array.isArray(src.tags)) {
    data.tags = src.tags.filter((t) => typeof t === "string");
  }
  if (typeof src.readMinutes === "number" && src.readMinutes > 0) {
    data.readMinutes = Math.floor(src.readMinutes);
  }
  if ("publishedAt" in src) {
    data.publishedAt =
      typeof src.publishedAt === "string" && src.publishedAt
        ? new Date(src.publishedAt)
        : null;
  }
  if ("body" in src) {
    if (!isArticleBlockArray(src.body)) {
      return NextResponse.json(
        { error: "body должен быть массивом ArticleBlock" },
        { status: 400 }
      );
    }
    data.body = src.body as unknown as object;
  }

  const before = await articlePublishState(id);
  const updated = await db.article.update({
    where: { id },
    data,
  });
  await refreshPromoDataset("blog-articles").catch((error) =>
    console.error("[blog] promo snapshot refresh failed", error),
  );
  // Впервые опубликована — анонс в Telegram-канал (если канал задан).
  await announceArticleIfPublished({ before: before ?? { publishedAt: null }, after: updated }).catch(() => false);
  return NextResponse.json({ article: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await requireRoot();
  const { id } = await context.params;
  await db.article.delete({ where: { id } });
  await refreshPromoDataset("blog-articles").catch((error) =>
    console.error("[blog] promo snapshot refresh failed", error),
  );
  return NextResponse.json({ ok: true });
}

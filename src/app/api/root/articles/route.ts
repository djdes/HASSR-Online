import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isArticleBlockArray } from "@/lib/article-blocks";
import { announceArticleIfPublished } from "@/lib/blog-announce";
import { refreshPromoDataset } from "@/lib/promo-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/root/articles — list + create. ROOT-only. Middleware 404s non-root.
 *
 * Body is kept as raw JSON (ArticleBlock[]); we validate shape with
 * isArticleBlockArray so the admin cannot sneak in unknown block types
 * that would crash the renderer.
 */
export async function GET() {
  await requireRoot();
  const articles = await db.article.findMany({
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ articles });
}

export async function POST(request: Request) {
  await requireRoot();
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const {
    slug,
    title,
    excerpt,
    body: articleBody,
    coverIcon,
    tags,
    readMinutes,
    publishedAt,
  } = body as Record<string, unknown>;

  if (
    typeof slug !== "string" ||
    !slug ||
    typeof title !== "string" ||
    typeof excerpt !== "string"
  ) {
    return NextResponse.json(
      { error: "slug, title, excerpt обязательны" },
      { status: 400 }
    );
  }
  if (!isArticleBlockArray(articleBody)) {
    return NextResponse.json(
      { error: "body должен быть массивом ArticleBlock" },
      { status: 400 }
    );
  }

  const created = await db.article.create({
    data: {
      slug,
      title,
      excerpt,
      body: articleBody as unknown as object,
      coverIcon: typeof coverIcon === "string" ? coverIcon : null,
      tags: Array.isArray(tags) ? tags.filter((t) => typeof t === "string") : [],
      readMinutes:
        typeof readMinutes === "number" && readMinutes > 0
          ? Math.floor(readMinutes)
          : 5,
      publishedAt:
        typeof publishedAt === "string" && publishedAt
          ? new Date(publishedAt)
          : null,
    },
  });
  await refreshPromoDataset("blog-articles").catch((error) =>
    console.error("[blog] promo snapshot refresh failed", error),
  );
  await announceArticleIfPublished({ before: { publishedAt: null }, after: created }).catch(() => false);
  return NextResponse.json({ article: created });
}

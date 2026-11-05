import { SeoSubnav } from "@/components/root/seo-subnav";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isTopvisorConfigured } from "@/lib/topvisor";

import { PositionsClient } from "./positions-client";

export const dynamic = "force-dynamic";

/**
 * Позиции из Topvisor. Соседняя страница /root/seo — «SEO-здоровье»
 * (обход sitemap), это другой раздел, поэтому вкладки сверху.
 *
 * Смысл экрана не в том, чтобы повторить панель Topvisor, а в связке,
 * которой там нет: страница, которой поисковик ответил на запрос,
 * сопоставляется со статьями блога Wesetup.
 */
export default async function RootSeoPositionsPage() {
  await requireRoot();

  // Слаги статей нужны, чтобы отличить «ранжируется статья блога» от
  // «ранжируется случайная страница»: Topvisor про блог ничего не знает.
  const articles = await db.article.findMany({
    select: { slug: true, title: true, publishedAt: true },
  });
  const articleBySlug = Object.fromEntries(
    articles.map((a) => [
      a.slug,
      { title: a.title, published: a.publishedAt != null },
    ])
  );

  let linksBadgeCount = 0;
  try {
    const [unreadThreads, pendingSlots] = await Promise.all([
      db.gglThread.count({
        where: {
          campaign: { isWesetup: true },
          OR: [{ unreadCount: { gt: 0 } }, { needsReply: true }],
        },
      }),
      db.gglPlannedSlot.count({
        where: {
          status: "pending_approval",
          plan: { campaign: { isWesetup: true } },
        },
      }),
    ]);
    linksBadgeCount = unreadThreads + pendingSlots;
  } catch {
    linksBadgeCount = 0;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">
          Позиции
        </h1>
        <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">
          Матрица «фраза × дата» из Topvisor. Под каждой фразой — страница,
          которой поисковик ответил на запрос: видно, попал ли он в нужную
          посадочную и есть ли под запрос статья в блоге.
        </p>
      </div>

      <SeoSubnav active="positions" linksBadgeCount={linksBadgeCount} />

      <PositionsClient
        configured={isTopvisorConfigured()}
        articleBySlug={articleBySlug}
      />
    </div>
  );
}

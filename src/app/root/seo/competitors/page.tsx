import { SeoSubnav } from "@/components/root/seo-subnav";
import { SimilarwebCompetitorsWorkspace } from "@/components/root/seo-links/SimilarwebCompetitorsWorkspace";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Конкуренты и сверка спроса (Similarweb) — SEO Wesetup",
};

/**
 * Раздел /root/seo/competitors — анализ трафика и поисковых кластеров конкурентов
 * через Similarweb (api-anything + OCR скриншотов) и сверка с позициями Topvisor
 * и посадочными страницами wesetup.ru.
 */
export default async function RootSeoCompetitorsPage() {
  await requireRoot();

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
          Конкуренты и сверка спроса (Similarweb)
        </h1>
        <p className="mt-1 max-w-[820px] text-[14px] leading-relaxed text-[#6f7282]">
          Сверка трафика, каналов привлечения и поисковых кластеров конкурентов (haccp-online.ru, checkoffice.ru и др.) с посадочными страницами wesetup.ru и позициями в Topvisor. Загрузка данных напрямую через api-anything или распознавание скриншотов Similarweb.
        </p>
      </div>

      <SeoSubnav active="competitors" linksBadgeCount={linksBadgeCount} />

      <SimilarwebCompetitorsWorkspace />
    </div>
  );
}

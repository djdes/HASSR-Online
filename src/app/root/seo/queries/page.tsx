import { SeoSubnav } from "@/components/root/seo-subnav";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

import { QueriesClient } from "./queries-client";

export const dynamic = "force-dynamic";

/**
 * Поисковые запросы: Google (Search Console + поведение из Метрики по странице
 * входа) и фразы Яндекса из Метрики — то же, что `npm run seo:export`.
 */
export default async function RootSeoQueriesPage() {
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
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">Поисковые запросы</h1>
        <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">
          Google не передаёт фразы в Метрику, поэтому запросы, клики и позиции берутся из Search Console, а
          визиты, отказы и цели — из Метрики по странице входа. Яндекс — отчёт Метрики «Поисковые фразы».
        </p>
      </div>

      <SeoSubnav active="queries" linksBadgeCount={linksBadgeCount} />

      <QueriesClient />
    </div>
  );
}

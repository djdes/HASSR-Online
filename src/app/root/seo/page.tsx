import { SeoSubnav } from "@/components/root/seo-subnav";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

import { SeoHealthClient } from "./seo-client";

export const dynamic = "force-dynamic";

/** SEO-здоровье: обход всех адресов sitemap, проблемы по страницам. */
export default async function RootSeoPage() {
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
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">SEO-здоровье</h1>
        <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">
          Обходит все адреса из sitemap на самом сервере: пустые и длинные title и description, отсутствие canonical и og:image, число h1, дубли заголовков, битые внутренние ссылки, медленные страницы. Отчёт держится час.
        </p>
      </div>
      <SeoSubnav active="health" linksBadgeCount={linksBadgeCount} />

      <SeoHealthClient />
    </div>
  );
}

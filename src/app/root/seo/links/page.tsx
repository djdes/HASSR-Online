import type { SeoLinksViewerCapabilities } from "@/components/root/seo-links/types";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  isPlatformAdministrator,
  PLATFORM_SECTION_KEYS,
} from "@/lib/platform-access";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { canApproveGglSpend } from "@/lib/seo/gogetlinks-access";
import { getCachedWesetupApplicationsCount } from "@/lib/seo/gogetlinks-applications.server";

import { SeoLinksClient } from "./links-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ссылочное продвижение GoGetLinks — SEO Wesetup",
};

/**
 * Раздел /root/seo/links — ссылочное продвижение wesetup.ru через GoGetLinks:
 * 1. Планировщик закупок на 30 дней с обязательным ручным подтверждением слота.
 * 2. Единый реестр закупок с прозрачной атрибуцией «Кто купил».
 * 3. Двусторонние чаты с вебмастерами и приёмка/доработка размещений.
 * 4. Срезы конкурентов Similarweb + позиции Topvisor + подключение GoGetLinks.
 */
export default async function RootSeoLinksPage() {
  const session = await requireRoot();
  const viewer = await platformViewerForSession(session);

  const isSuperadmin = viewer.superadmin;
  const platformSections = isSuperadmin
    ? [...PLATFORM_SECTION_KEYS]
    : [...viewer.sections];
  const actor = {
    isRoot: isSuperadmin,
    platformSections,
  };
  const isPlatformAdmin = isPlatformAdministrator(actor);

  let allowSeoApproveWithinPlan = false;
  let accountConnected = false;
  let unreadThreads = 0;
  let pendingSlots = 0;
  let webmasterApplications = 0;

  try {
    const [account, unreadCount, pendingCount, applicationsCount] = await Promise.all([
      db.gglAccount.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true, allowSeoApproveWithinPlan: true },
      }),
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
      getCachedWesetupApplicationsCount(),
    ]);
    accountConnected = Boolean(account);
    allowSeoApproveWithinPlan = Boolean(account?.allowSeoApproveWithinPlan);
    unreadThreads = unreadCount;
    pendingSlots = pendingCount;
    webmasterApplications = applicationsCount;
  } catch {
    accountConnected = false;
    allowSeoApproveWithinPlan = false;
  }

  const viewerCapabilities: SeoLinksViewerCapabilities = {
    userId: session.user.id,
    userName: session.user.name?.trim() || session.user.email?.trim() || "root",
    isSuperadmin,
    isPlatformAdmin,
    hasSeoSection: isSuperadmin || platformSections.includes("seo"),
    canApproveWithinPlan: canApproveGglSpend(actor, {
      allowSeoApproveWithinPlan,
      withinApprovedPlan: true,
    }),
    canManagePlans: canApproveGglSpend(actor, {
      allowSeoApproveWithinPlan,
      withinApprovedPlan: false,
    }),
  };

  return (
    <SeoLinksClient
      viewer={viewerCapabilities}
      initialBadgeCount={webmasterApplications + unreadThreads + pendingSlots}
      initialHasPendingSlots={pendingSlots > 0}
      initialAccountConnected={accountConnected}
      initialAllowSeoApprove={allowSeoApproveWithinPlan}
    />
  );
}

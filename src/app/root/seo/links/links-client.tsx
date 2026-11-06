"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarClock,
  ListChecks,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { SeoSubnav } from "@/components/root/seo-subnav";
import { ChatsTab } from "@/components/root/seo-links/ChatsTab";
import { DemandAndAccountTab } from "@/components/root/seo-links/DemandAndAccountTab";
import { OrdersRegistryTab } from "@/components/root/seo-links/OrdersRegistryTab";
import { PlannerTab } from "@/components/root/seo-links/PlannerTab";
import { SeoLinksHeaderMetrics } from "@/components/root/seo-links/SeoLinksHeaderMetrics";
import type {
  GglOverviewResponse,
  SeoLinksViewerCapabilities,
} from "@/components/root/seo-links/types";

export type SeoLinksWorkspaceTab = "planner" | "orders" | "chats" | "demand";

export interface SeoLinksClientProps {
  viewer: SeoLinksViewerCapabilities;
  initialBadgeCount: number;
  initialHasPendingSlots: boolean;
  initialAccountConnected: boolean;
  initialAllowSeoApprove: boolean;
}

export function SeoLinksClient({
  viewer,
  initialBadgeCount,
  initialHasPendingSlots,
  initialAccountConnected,
  initialAllowSeoApprove,
}: SeoLinksClientProps) {
  const [activeTab, setActiveTab] = useState<SeoLinksWorkspaceTab>(() => {
    if (initialHasPendingSlots) return "planner";
    if (!initialAccountConnected) return "demand";
    return "planner";
  });
  const [includeOtherProjects, setIncludeOtherProjects] = useState(false);
  const [overview, setOverview] = useState<GglOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  const [didApplyInitialTabRule, setDidApplyInitialTabRule] = useState(false);

  const loadOverview = useCallback(
    async (otherProjectsFlag = includeOtherProjects) => {
      try {
        const response = await fetch(
          `/api/root/gogetlinks/overview?includeOtherProjects=${
            otherProjectsFlag ? "true" : "false"
          }`,
        );
        const data = (await response.json().catch(() => null)) as
          | (GglOverviewResponse & { error?: string })
          | null;
        if (!response.ok || !data) {
          throw new Error(
            data?.error ?? "Не удалось загрузить данные раздела ссылок",
          );
        }
        setOverview(data);
        if (!didApplyInitialTabRule) {
          setDidApplyInitialTabRule(true);
          if (data.metrics.counts.pendingApprovalSlots > 0) {
            setActiveTab("planner");
          }
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Ошибка загрузки обзора GoGetLinks",
        );
      } finally {
        setLoading(false);
      }
    },
    [includeOtherProjects, didApplyInitialTabRule],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) {
        await loadOverview(includeOtherProjects);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [includeOtherProjects, loadOverview]);

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const response = await fetch("/api/root/gogetlinks/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeThreads: true }),
      });
      const data = (await response.json().catch(() => null)) as {
        campaignsCount?: number;
        ordersCount?: number;
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          data?.error ?? "Синхронизация с GoGetLinks завершилась с ошибкой",
        );
      }
      toast.success(
        `Синхронизировано с GoGetLinks: кампаний ${
          data?.campaignsCount ?? 0
        }, заявок ${data?.ordersCount ?? 0}`,
      );
      await loadOverview(includeOtherProjects);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка синхронизации");
    } finally {
      setSyncing(false);
    }
  }

  function handleToggleOtherProjects(next: boolean) {
    setIncludeOtherProjects(next);
  }

  function handleJumpToThread(threadId: string | null, donorDomain?: string) {
    if (threadId) {
      setFocusedThreadId(threadId);
      setActiveTab("chats");
      return;
    }
    if (donorDomain && overview) {
      const matched = overview.threads.find(
        (t) =>
          t.donorDomain?.toLowerCase() === donorDomain.trim().toLowerCase(),
      );
      if (matched) {
        setFocusedThreadId(matched.id);
        setActiveTab("chats");
        return;
      }
    }
    setActiveTab("chats");
    toast.info(
      "Отдельного диалога по этой заявке в GoGetLinks пока нет — открыт список переписок",
    );
  }

  const effectiveViewer = useMemo<SeoLinksViewerCapabilities>(() => {
    const allowSeo =
      overview?.account?.allowSeoApproveWithinPlan ?? initialAllowSeoApprove;
    const canApproveWithinPlan =
      viewer.isPlatformAdmin || (allowSeo && viewer.hasSeoSection);
    return {
      ...viewer,
      canApproveWithinPlan,
    };
  }, [
    viewer,
    overview?.account?.allowSeoApproveWithinPlan,
    initialAllowSeoApprove,
  ]);

  const counts = overview?.metrics.counts;
  const liveBadgeCount = counts
    ? counts.unreadThreads + counts.pendingApprovalSlots
    : initialBadgeCount;

  const tabs: Array<{
    key: SeoLinksWorkspaceTab;
    label: string;
    icon: typeof CalendarClock;
    badge?: number;
  }> = [
    {
      key: "planner",
      label: "Планировщик и слоты",
      icon: CalendarClock,
      badge: counts?.pendingApprovalSlots ?? 0,
    },
    {
      key: "orders",
      label: "Все закупки",
      icon: ListChecks,
      badge: counts?.onCheckOrders ?? 0,
    },
    {
      key: "chats",
      label: "Чаты",
      icon: MessageSquare,
      badge: counts?.unreadThreads ?? 0,
    },
    {
      key: "demand",
      label: "Спрос Similarweb и подключение",
      icon: BarChart3,
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">
          Ссылочное продвижение (GoGetLinks)
        </h1>
        <p className="mt-1 max-w-[820px] text-[14px] leading-relaxed text-[#6f7282]">
          Управление вечными ссылками wesetup.ru через GoGetLinks: приоритизация посадочных от спроса Similarweb и позиций Topvisor, подготовка статей, двусторонние чаты с вебмастерами и расписание слотов со строгим ручным подтверждением перед списанием.
        </p>
      </div>

      <SeoSubnav active="links" linksBadgeCount={liveBadgeCount} />

      <SeoLinksHeaderMetrics
        account={overview?.account ?? null}
        metrics={overview?.metrics ?? null}
        syncing={syncing}
        onSyncNow={() => void handleSyncNow()}
        includeOtherProjects={includeOtherProjects}
        onToggleIncludeOtherProjects={handleToggleOtherProjects}
        onOpenTab={setActiveTab}
      />

      {/* 4 Workspace Tabs */}
      <div
        role="tablist"
        aria-label="Рабочие вкладки ссылочного продвижения"
        className="flex flex-wrap items-center gap-1.5 border-b border-[#ececf4] pb-3"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-[13.5px] font-medium transition-colors ${
                isActive
                  ? "bg-[#5566f6] text-white shadow-[0_10px_24px_-12px_rgba(85,102,246,0.55)]"
                  : "border border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              }`}
            >
              <Icon
                className={`size-4 ${
                  isActive ? "text-white" : "text-[#5566f6]"
                }`}
              />
              {tab.label}
              {tab.badge && tab.badge > 0 ? (
                <span
                  className={`inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
                    isActive
                      ? "bg-white text-[#3848c7]"
                      : "bg-[#eef1ff] text-[#3848c7]"
                  }`}
                >
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {loading && !overview ? (
        <div className="flex items-center justify-center gap-2.5 rounded-3xl border border-[#ececf4] bg-white py-20 text-[14px] text-[#6f7282]">
          <Loader2 className="size-5 animate-spin text-[#5566f6]" />
          Загружаем данные закупок, чатов и расписания GoGetLinks…
        </div>
      ) : (
        <>
          {activeTab === "planner" ? (
            <PlannerTab
              campaigns={overview?.campaigns ?? []}
              defaultGglCampaignId={overview?.account?.defaultCampaignId ?? null}
              accountConnected={Boolean(overview?.account)}
              plans={overview?.plans ?? []}
              slots={overview?.slots ?? []}
              viewer={effectiveViewer}
              onRefresh={() => loadOverview(includeOtherProjects)}
            />
          ) : null}

          {activeTab === "orders" ? (
            <OrdersRegistryTab
              orders={overview?.orders ?? []}
              campaigns={overview?.campaigns ?? []}
              threads={overview?.threads ?? []}
              viewer={effectiveViewer}
              onJumpToThread={handleJumpToThread}
              onRefresh={() => loadOverview(includeOtherProjects)}
            />
          ) : null}

          {activeTab === "chats" ? (
            <ChatsTab
              threads={overview?.threads ?? []}
              focusedThreadId={focusedThreadId}
              onSelectThread={setFocusedThreadId}
              onRefreshOverview={() => loadOverview(includeOtherProjects)}
            />
          ) : null}

          {activeTab === "demand" ? (
            <DemandAndAccountTab
              account={overview?.account ?? null}
              campaigns={overview?.campaigns ?? []}
              snapshots={overview?.similarwebSnapshots ?? []}
              viewer={effectiveViewer}
              onRefreshOverview={() => loadOverview(includeOtherProjects)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

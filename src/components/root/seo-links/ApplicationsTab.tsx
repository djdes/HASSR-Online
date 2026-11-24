"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Code2, ExternalLink, Eye, FileText, Loader2, MessageSquare, RefreshCw, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { GglApplication, GglApplicationsView, GglSiteCardResult, GglWebmasterAnalysis } from "@/lib/seo/gogetlinks-applications";
import { sanitizeArticleHtmlForPreview } from "@/lib/seo/gogetlinks-ui-format";
import {
  getCachedApplicationsUiState,
  getCachedApplicationsView,
  invalidateApplicationsCache,
  invalidateOverviewCache,
  setCachedApplicationsUiState,
  setCachedApplicationsView,
} from "./tab-cache";
import type { GglCampaignDto, GglPlannedSlotDto, GglThreadDto } from "./types";
import {
  findMatchingSlotForDonor,
  findWebmasterMatchingApplications,
  getApplicationThreadPriority,
  mergeApplicationsWithThreadDonors,
} from "./webmaster-placement-lookup";

const endpoint = "/api/root/gogetlinks/applications";
const ordersEndpoint = "/api/root/gogetlinks/orders";
const PAGE_CHUNK = 40;
const button = "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13px] font-medium text-[#0b1024] hover:bg-[#f5f6ff] disabled:opacity-50";
const input = "h-10 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none";
const metric = (n: number | null) => (n === null ? "—" : n.toLocaleString("ru-RU"));
const verdicts = { recommended: "Рекомендует", consider: "Рассмотреть", avoid: "Не рекомендует" };

export const UNIFIED_BRIEF_TEXT =
  "Больше 80 сайтов в работе — аккуратно размещаете и заношу площадку в Белый Список. Очень важно аккуратное размещение: ссылку вставить в середине или конце предложения без nofollow/noindex/sponsored, сохранить индексацию страницы.";

export const TARGET_PRESETS: Array<{
  url: string;
  label: string;
  defaultAnchor: string;
  anchorOptions: Array<{ kind: string; value: string }>;
}> = [
  {
    url: "https://wesetup.ru/journals-info",
    label: "Каталог электронных журналов ХАССП (/journals-info)",
    defaultAnchor: "электронные журналы ХАССП",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "wesetup.ru" },
      { kind: "Контекстный (30%)", value: "в системе электронных журналов" },
      { kind: "Точный (20%)", value: "электронные журналы ХАССП" },
    ],
  },
  {
    url: "https://wesetup.ru/",
    label: "Главная WeSetup — ХАССП и СанПиН (/)",
    defaultAnchor: "wesetup.ru",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "wesetup.ru" },
      { kind: "Бренд (30%)", value: "WeSetup" },
      { kind: "Контекстный (20%)", value: "на платформе WeSetup" },
    ],
  },
  {
    url: "https://wesetup.ru/zhurnal-haccp",
    label: "Журналы ХАССП для общепита (/zhurnal-haccp)",
    defaultAnchor: "журналы ХАССП",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "на сайте wesetup.ru" },
      { kind: "Контекстный (30%)", value: "перечень обязательных журналов" },
      { kind: "Точный (20%)", value: "журналы ХАССП" },
    ],
  },
  {
    url: "https://wesetup.ru/journals-info/finished_product",
    label: "Бракеражный журнал готовой продукции (/journals-info/finished_product)",
    defaultAnchor: "бракеражный журнал готовой продукции",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "в сервисе WeSetup" },
      { kind: "Контекстный (30%)", value: "в электронном бракеражном журнале" },
      { kind: "Точный (20%)", value: "бракеражный журнал готовой продукции" },
    ],
  },
  {
    url: "https://wesetup.ru/journals-info/health_check",
    label: "Гигиенический журнал сотрудников (/journals-info/health_check)",
    defaultAnchor: "гигиенический журнал сотрудников",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "wesetup.ru" },
      { kind: "Контекстный (30%)", value: "осмотр персонала перед сменой" },
      { kind: "Точный (20%)", value: "гигиенический журнал сотрудников" },
    ],
  },
  {
    url: "https://wesetup.ru/journals-info/cold_equipment_control",
    label: "Журнал температурного режима холодильников (/journals-info/cold_equipment_control)",
    defaultAnchor: "журнал учета температурного режима холодильного оборудования",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "в системе WeSetup" },
      { kind: "Контекстный (30%)", value: "контроль температуры холодильников" },
      { kind: "Точный (20%)", value: "журнал учета температурного режима холодильного оборудования" },
    ],
  },
  {
    url: "https://wesetup.ru/journals-info/climate_control",
    label: "Журнал температуры и влажности (/journals-info/climate_control)",
    defaultAnchor: "журнал учета температурного режима",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "wesetup.ru" },
      { kind: "Контекстный (30%)", value: "фиксация микроклимата на складе" },
      { kind: "Точный (20%)", value: "журнал учета температурного режима" },
    ],
  },
  {
    url: "https://wesetup.ru/journals-info/general_cleaning",
    label: "Журнал генеральных уборок (/journals-info/general_cleaning)",
    defaultAnchor: "журнал проведения генеральных уборок",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "на платформе WeSetup" },
      { kind: "Контекстный (30%)", value: "график и учёт санитарной обработки" },
      { kind: "Точный (20%)", value: "журнал проведения генеральных уборок" },
    ],
  },
  {
    url: "https://wesetup.ru/journals-info/uv_lamp_runtime",
    label: "Бактерицидный журнал (/journals-info/uv_lamp_runtime)",
    defaultAnchor: "бактерицидный журнал",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "wesetup.ru" },
      { kind: "Контекстный (30%)", value: "учёт часов работы облучателей" },
      { kind: "Точный (20%)", value: "бактерицидный журнал" },
    ],
  },
  {
    url: "https://wesetup.ru/journals-info/incoming_control",
    label: "Журнал входного контроля сырья (/journals-info/incoming_control)",
    defaultAnchor: "журнал входного контроля сырья",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "в сервисе WeSetup" },
      { kind: "Контекстный (30%)", value: "приёмка продуктов и проверка маркировки" },
      { kind: "Точный (20%)", value: "журнал входного контроля сырья" },
    ],
  },
  {
    url: "https://wesetup.ru/journals-info/fryer_oil",
    label: "Журнал учёта фритюрных жиров (/journals-info/fryer_oil)",
    defaultAnchor: "журнал учета фритюрных жиров",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "wesetup.ru" },
      { kind: "Контекстный (30%)", value: "контроль замены фритюрного масла" },
      { kind: "Точный (20%)", value: "журнал учета фритюрных жиров" },
    ],
  },
  {
    url: "https://wesetup.ru/sanpin-2-3-2-4-4282-26",
    label: "СанПиН 2.3/2.4.4282-26 для общепита (/sanpin-2-3-2-4-4282-26)",
    defaultAnchor: "журналы по СанПиН для общепита",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "wesetup.ru" },
      { kind: "Контекстный (30%)", value: "требования нового СанПиН для общепита" },
      { kind: "Точный (20%)", value: "журналы по СанПиН для общепита" },
    ],
  },
  {
    url: "https://wesetup.ru/calc/journals",
    label: "Подбор комплекта журналов ХАССП (/calc/journals)",
    defaultAnchor: "какие журналы нужны в кафе",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "калькулятор журналов WeSetup" },
      { kind: "Контекстный (30%)", value: "подобрать комплект санитарных журналов" },
      { kind: "Точный ВЧ (20%)", value: "какие журналы нужны в кафе" },
    ],
  },
  {
    // Лендинг /elektronnyy-zhurnal-sanpin слит в главную (seo-speed-pack-2026-11).
    url: "https://wesetup.ru/",
    label: "Электронные журналы СанПиН и ХАССП — главная (/)",
    defaultAnchor: "электронный журнал СанПиН",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "в сервисе WeSetup" },
      { kind: "Контекстный (30%)", value: "ведение электронных журналов по СанПиН" },
      { kind: "Точный ВЧ (20%)", value: "электронный журнал СанПиН" },
    ],
  },
  {
    url: "https://wesetup.ru/uslugi",
    label: "Разработка и внедрение ХАССП под ключ (/uslugi)",
    defaultAnchor: "разработка ХАССП для общепита",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "wesetup.ru" },
      { kind: "Контекстный (30%)", value: "подготовка документации ХАССП к проверке Роспотребнадзора" },
      { kind: "Точный ВЧ (20%)", value: "разработка ХАССП для общепита" },
    ],
  },
  {
    url: "https://wesetup.ru/prikazy",
    label: "Обязательные приказы по ХАССП и СанПиН (/prikazy)",
    defaultAnchor: "приказы по ХАССП для общепита",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "на портале WeSetup" },
      { kind: "Контекстный (30%)", value: "шаблоны обязательных приказов по пищевой безопасности" },
      { kind: "Точный ВЧ (20%)", value: "приказы по ХАССП для общепита" },
    ],
  },
  {
    url: "https://wesetup.ru/dlya-kafe",
    label: "ВЧ Посадочная: ХАССП для кафе и ресторанов (/dlya-kafe)",
    defaultAnchor: "хассп для кафе",
    anchorOptions: [
      { kind: "Бренд/URL (50%)", value: "wesetup.ru" },
      { kind: "Контекстный (30%)", value: "разработка и ведение ХАССП в общепите" },
      { kind: "Точный ВЧ (20%)", value: "хассп для кафе" },
    ],
  },
];

export interface GeneratedDraft {
  title: string;
  announcement: string;
  bodyHtml: string;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
  briefText: string;
}

export function resolvePlacementFormat(placementType: string): "article" | "note" | "context" {
  const lower = placementType.toLowerCase();
  if (lower.includes("контекст")) return "context";
  if (lower.includes("замет")) return "note";
  return "article";
}

async function api<T>(body?: unknown, campaignId?: number): Promise<T> {
  const response = await fetch(
    body ? endpoint : `${endpoint}${campaignId ? `?campaignId=${campaignId}` : ""}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const err = new Error(data?.error ?? `Ошибка запроса (${response.status})`) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return data as T;
}

export function ApplicationsTab({
  campaigns,
  defaultCampaignId,
  threads = [],
  slots = [],
  accountSyncedAt = null,
  expectedApplicationsCount = null,
  onCountChange,
  onOrderCreated,
  onJumpToThread,
}: {
  campaigns: GglCampaignDto[];
  defaultCampaignId: number | null;
  threads?: GglThreadDto[];
  slots?: GglPlannedSlotDto[];
  accountSyncedAt?: string | null;
  expectedApplicationsCount?: number | null;
  onCountChange?: (count: number) => void;
  onOrderCreated?: () => void;
  onJumpToThread?: (threadId: string | null, donorDomain?: string) => void;
}) {
  const [campaignId, setCampaignId] = useState<number | undefined>(defaultCampaignId ?? undefined);
  const [view, setView] = useState<GglApplicationsView | null>(() =>
    getCachedApplicationsView(defaultCampaignId ?? undefined, {
      expectedCount: expectedApplicationsCount,
      accountSyncedAt,
    }),
  );
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const initialUiState = getCachedApplicationsUiState(defaultCampaignId ?? undefined);
  const [query, setQuery] = useState(initialUiState?.query ?? "");
  const [sort, setSort] = useState(initialUiState?.sort ?? "recommendations");
  const [visibleCount, setVisibleCount] = useState(initialUiState?.visibleCount ?? PAGE_CHUNK);
  const [selected, setSelected] = useState<GglApplication | null>(null);
  const [targetUrl, setTargetUrl] = useState(TARGET_PRESETS[0].url);
  const [anchor, setAnchor] = useState(TARGET_PRESETS[0].defaultAnchor);
  const [draft, setDraft] = useState<GeneratedDraft | null>(null);
  const [editorMode, setEditorMode] = useState<"html" | "preview">("html");
  const [drafting, setDrafting] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const mounted = useRef(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCachedApplicationsUiState(campaignId, { query, sort, visibleCount });
  }, [campaignId, query, sort, visibleCount]);

  const load = useCallback(
    async (refresh = false) => {
      if (!refresh) {
        const cached = getCachedApplicationsView(campaignId, {
          expectedCount: expectedApplicationsCount,
          accountSyncedAt,
        });
        if (cached) {
          setView(cached);
          onCountChange?.(Math.max(cached.snapshot.sourceTotal ?? 0, cached.snapshot.applications.length));
          return;
        }
      } else {
        invalidateApplicationsCache(campaignId);
      }

      setLoading(true);
      setError(null);
      try {
        const value = await api<GglApplicationsView>(
          refresh ? { action: "refresh", campaignId } : undefined,
          campaignId,
        );
        setCachedApplicationsView(campaignId, value, {
          expectedCount: Math.max(value.snapshot.sourceTotal ?? 0, value.snapshot.applications.length),
          accountSyncedAt,
        });
        if (mounted.current) {
          setView(value);
          if (refresh) setVisibleCount(PAGE_CHUNK);
          onCountChange?.(Math.max(value.snapshot.sourceTotal ?? 0, value.snapshot.applications.length));
        }
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : "Ошибка загрузки");
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [campaignId, expectedApplicationsCount, accountSyncedAt, onCountChange],
  );

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const cardMap = useMemo(() => new Map(view?.cards.map(c => [c.siteId, c]) ?? []), [view?.cards]);
  const recommendations = useMemo(
    () => new Map(view?.analysis?.recommendations.map((r, index) => [r.siteId, { ...r, index }]) ?? []),
    [view?.analysis],
  );
  const mergedApplications = useMemo(
    () =>
      mergeApplicationsWithThreadDonors({
        applications: view?.snapshot.applications ?? [],
        threads,
        slots,
        campaignId: view?.campaignId ?? campaignId ?? defaultCampaignId ?? 0,
      }),
    [view?.snapshot.applications, view?.campaignId, threads, slots, campaignId, defaultCampaignId],
  );
  const siteCount = new Set(mergedApplications.map(a => a.siteId)).size;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mergedApplications
      .filter(
        a =>
          !q ||
          `${a.domain} ${a.placementType} ${cardMap.get(a.siteId)?.card?.fields.map(f => f.value).join(" ") ?? ""}`
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => {
        if (sort === "price") return (a.priceRub ?? Infinity) - (b.priceRub ?? Infinity);
        if (sort === "trust") return (b.trust ?? -1) - (a.trust ?? -1);
        if (sort === "traffic") return (b.dailyTraffic ?? -1) - (a.dailyTraffic ?? -1);
        const aThreadPriority = getApplicationThreadPriority(a, threads).priorityRank;
        const bThreadPriority = getApplicationThreadPriority(b, threads).priorityRank;
        if (aThreadPriority !== bThreadPriority) return aThreadPriority - bThreadPriority;
        return (
          (recommendations.get(a.siteId)?.index ?? Infinity) -
            (recommendations.get(b.siteId)?.index ?? Infinity) || (b.trust ?? -1) - (a.trust ?? -1)
        );
      });
  }, [mergedApplications, query, cardMap, sort, recommendations, threads]);

  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);
  const hasMore = visibleCount < rows.length;

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisibleCount(current => Math.min(rows.length, current + PAGE_CHUNK));
        }
      },
      { rootMargin: "320px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, rows.length]);

  function mergeCards(current: GglApplicationsView, cards: GglSiteCardResult[]) {
    const merged = new Map(current.cards.map(c => [c.siteId, c]));
    cards.forEach(c => merged.set(c.siteId, c));
    return { ...current, cards: [...merged.values()] };
  }

  async function openCard(application: GglApplication) {
    setSelected(application);
    const matchingSlot = findMatchingSlotForDonor({
      slots,
      donorSiteId: application.siteId,
      donorDomain: application.domain,
    });
    if (matchingSlot?.targetUrl) {
      const trimmed = matchingSlot.targetUrl.trim();
      const fullUrl =
        trimmed.startsWith("http://") || trimmed.startsWith("https://")
          ? trimmed
          : `https://wesetup.ru${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
      setTargetUrl(fullUrl);
      setAnchor(
        matchingSlot.anchor?.trim() ||
          TARGET_PRESETS.find(p => p.url === fullUrl)?.defaultAnchor ||
          TARGET_PRESETS[0].defaultAnchor,
      );
    }
    if (matchingSlot?.article?.title && matchingSlot?.article?.bodyHtml) {
      setDraft({
        title: matchingSlot.article.title,
        announcement: matchingSlot.article.announcement ?? "",
        bodyHtml: matchingSlot.article.bodyHtml,
        metaTitle: matchingSlot.article.title,
        metaDescription: matchingSlot.article.announcement ?? "",
        metaKeywords: matchingSlot.anchor ?? "",
        briefText: matchingSlot.briefText ?? UNIFIED_BRIEF_TEXT,
      });
    } else {
      setDraft(null);
    }
    if (!view || cardMap.get(application.siteId)?.card) return;
    setBusy(true);
    try {
      const result = await api<{ cards: GglSiteCardResult[] }>({
        action: "cards",
        campaignId: view.campaignId,
        snapshotId: view.snapshotId,
        siteIds: [application.siteId],
      });
      if (mounted.current) {
        setView(current => {
          if (!current) return current;
          const next = mergeCards(current, result.cards);
          setCachedApplicationsView(campaignId, next, {
            expectedCount: Math.max(next.snapshot.sourceTotal ?? 0, next.snapshot.applications.length),
            accountSyncedAt,
          });
          return next;
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить карточку");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function handleGenerateDraft() {
    if (!selected) return;
    const cleanAnchor = anchor.trim();
    if (!cleanAnchor) {
      toast.error("Укажите текст анкора");
      return;
    }
    setDrafting(true);
    try {
      const format = resolvePlacementFormat(selected.placementType) === "article" ? "article" : "note";
      const topicField = cardMap.get(selected.siteId)?.card?.fields.find(f => f.label === "Тематика")?.value;
      const recReason = recommendations.get(selected.siteId)?.reason;
      const topicHint = [topicField, recReason].filter(Boolean).join(". ").slice(0, 450) || undefined;
      const result = await api<{ draft: GeneratedDraft }>({
        action: "draft",
        donorDomain: selected.domain,
        targetUrl,
        anchor: cleanAnchor,
        placementFormat: format,
        topicHint,
      });
      if (mounted.current) {
        setDraft(result.draft);
        toast.success(format === "article" ? "Черновик статьи готов — проверьте текст перед отправкой" : "ТЗ для вебмастера готово");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сгенерировать материал");
    } finally {
      if (mounted.current) setDrafting(false);
    }
  }

  async function handleSubmitOrder() {
    if (!selected) return;
    const placementFormat = resolvePlacementFormat(selected.placementType);
    const cleanAnchor = anchor.trim();
    if (!cleanAnchor) {
      toast.error("Укажите текст анкора");
      return;
    }
    if (placementFormat === "article" && (!draft?.title.trim() || !draft?.bodyHtml.trim())) {
      toast.error("Сначала сгенерируйте или заполните заголовок и текст статьи");
      return;
    }
    setSubmittingOrder(true);
    try {
      const activeCampaign = campaigns.find(c => c.gglCampaignId === (view?.campaignId ?? campaignId)) ?? campaigns.find(c => c.isWesetup);
      const response = await fetch(ordersEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: activeCampaign?.id,
          donorSiteId: selected.siteId,
          donorDomain: selected.domain,
          placementFormat,
          maxPriceRub: selected.priceRub ?? 1200,
          targetUrl,
          anchor: cleanAnchor,
          anchorKind: cleanAnchor.toLowerCase().includes("wesetup") ? "url_brand" : "exact",
          articleDraft:
            placementFormat === "article" && draft
              ? {
                  title: draft.title.trim(),
                  announcement: draft.announcement.trim(),
                  bodyHtml: draft.bodyHtml.trim(),
                  metaTitle: draft.metaTitle.trim(),
                  metaDescription: draft.metaDescription.trim(),
                  metaKeywords: draft.metaKeywords.trim(),
                }
              : null,
          briefText: draft?.briefText?.trim() || `Размещение ссылки ${targetUrl} с анкором «${cleanAnchor}» без атрибута nofollow.`,
          idempotencyKey: `app-${selected.id}-${selected.siteId}-${targetUrl}-${cleanAnchor}`.slice(0, 150),
        }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? `Ошибка отправки заявки (${response.status})`);
      }
      invalidateOverviewCache();
      invalidateApplicationsCache(campaignId);
      toast.success(`Заявка на ${selected.domain} отправлена вебмастеру в GoGetLinks`);
      setSelected(null);
      setDraft(null);
      onOrderCreated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отправить заявку");
    } finally {
      if (mounted.current) setSubmittingOrder(false);
    }
  }

  async function analyze() {
    if (!view) return;
    setBusy(true);
    setError(null);
    setProgress(`Диспетчер сравнивает все ${view.snapshot.applications.length.toLocaleString("ru-RU")} заявок…`);
    try {
      const result = await api<{ analysis: GglWebmasterAnalysis }>({
        action: "analyze",
        campaignId: view.campaignId,
        snapshotId: view.snapshotId,
      });
      if (mounted.current) {
        setView(current => {
          if (!current) return current;
          const next = { ...current, analysis: result.analysis };
          setCachedApplicationsView(campaignId, next, {
            expectedCount: Math.max(next.snapshot.sourceTotal ?? 0, next.snapshot.applications.length),
            accountSyncedAt,
          });
          return next;
        });
        toast.success("Рекомендации диспетчера готовы");
      }
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (mounted.current && (!status || status === 502 || status === 504)) {
        const pollDeadline = Date.now() + 180_000;
        while (mounted.current && Date.now() < pollDeadline) {
          setProgress("Диспетчер завершает расчёт рекомендаций по всем площадкам…");
          await new Promise(resolve => setTimeout(resolve, 4000));
          const latest = await api<GglApplicationsView>(undefined, campaignId).catch(() => null);
          if (latest?.analysis) {
            if (mounted.current) {
              setView(latest);
              toast.success("Рекомендации диспетчера готовы");
            }
            return;
          }
        }
      }
      if (mounted.current) {
        setError(e instanceof Error ? e.message : "Не удалось выполнить анализ");
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
        setProgress("");
      }
    }
  }

  const cardResult = selected ? cardMap.get(selected.siteId) : null;
  const card = cardResult?.card;
  const selectedRecommendation = selected ? recommendations.get(selected.siteId) : null;
  const selectedFormat = selected ? resolvePlacementFormat(selected.placementType) : "article";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Кампания для заявок"
          value={campaignId ?? ""}
          disabled={busy || loading}
          onChange={e => {
            setView(null);
            setSelected(null);
            setCampaignId(Number(e.target.value) || undefined);
          }}
          className={input}
        >
          <option value="">Основная кампания wesetup.ru</option>
          {campaigns
            .filter(c => c.isWesetup)
            .map(c => (
              <option key={c.id} value={c.gglCampaignId}>
                {c.name}
              </option>
            ))}
        </select>
        <button type="button" className={button} disabled={busy || loading} onClick={() => void load(true)}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Обновить заявки
        </button>
        <button
          type="button"
          disabled={busy || loading || !view?.snapshot.complete || !view.snapshot.applications.length}
          onClick={() => void analyze()}
          className={cn(button, "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]")}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Анализ всех площадок
        </button>
      </div>
      <p className="text-[13px] leading-relaxed text-[#6f7282]">
        Входящие предложения вебмастеров до покупки. Нажмите на выбранный домен, чтобы проверить примеры размещения, сгенерировать статью ИИ под площадку и отправить заявку.
      </p>
      {threads.filter(t => t.campaign?.isWesetup !== false).length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#d8deff] bg-[#eef1ff]/65 px-4 py-2.5 text-[12.5px]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#3848c7]">
            <MessageSquare className="size-3.5 text-[#5566f6]" />
            Диалоги с вебмастерами (нажмите для генерации размещения):
          </span>
          {threads
            .filter(t => t.campaign?.isWesetup !== false)
            .map(t => {
              const label = t.donorDomain || t.webmasterLogin || "Вебмастер";
              const matchedApps = findWebmasterMatchingApplications({
                applications: mergedApplications,
                thread: t,
                slots,
                campaignId: view?.campaignId ?? campaignId ?? defaultCampaignId ?? 0,
              });
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    if (matchedApps[0]) {
                      void openCard(matchedApps[0]);
                    } else if (t.donorDomain) {
                      setQuery(t.donorDomain);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#5566f6]/40 bg-white px-3 py-1 text-[12px] font-medium text-[#0b1024] shadow-xs transition-colors hover:border-[#5566f6] hover:bg-[#f5f6ff]"
                  title={
                    t.lastMessagePreview
                      ? `Последнее сообщение: ${t.lastMessagePreview}`
                      : `Открыть заявки и генерацию размещения для ${label}`
                  }
                >
                  <span className="font-semibold text-[#3848c7]">{label}</span>
                  {t.needsReply ? (
                    <span className="rounded-full bg-[#fffbeb] px-1.5 py-0.5 text-[10px] font-semibold text-[#92400e]">
                      Ждёт ответа
                    </span>
                  ) : null}
                  {t.unreadCount > 0 ? (
                    <span className="rounded-full bg-[#5566f6] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                      {t.unreadCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
        </div>
      ) : null}
      {progress ? (
        <p role="status" className="rounded-2xl bg-[#eef1ff] px-4 py-3 text-[13px] text-[#3848c7]">
          {progress}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]">
          {error}
        </p>
      ) : null}
      {loading && !view ? (
        <div role="status" className="flex items-center gap-2 rounded-3xl border border-[#ececf4] bg-white p-6 text-[14px] text-[#6f7282]">
          <Loader2 className="size-4 animate-spin" />
          Загружаем заявки GoGetLinks…
        </div>
      ) : null}
      {view ? (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-[#6f7282]">
            <span>
              Заявок: {view.snapshot.applications.length} из {view.snapshot.sourceTotal}
            </span>
            <span>Площадок: {siteCount}</span>
            <span>
              Показано: {visibleRows.length} из {rows.length}
            </span>
            <span>Срез: {new Date(view.snapshot.fetchedAt).toLocaleString("ru-RU")}</span>
          </div>
          {view.snapshot.warning ? (
            <p role="alert" className="rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]">
              {view.snapshot.warning}
            </p>
          ) : null}
          {view.analysis ? (
            <div className="space-y-3 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5">
              <h2 className="text-[18px] font-semibold text-[#0b1024]">Рекомендации диспетчера</h2>
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#3c4053]">{view.analysis.summary}</p>
              <p className="text-[12px] text-[#6f7282]">
                В анализ переданы все {view.snapshot.applications.length} заявок ({view.analysis.consideredSiteIds.length} площадок).{" "}
                {new Date(view.analysis.createdAt).toLocaleString("ru-RU")}. Короткий список — в таблице; остальные площадки рассмотрены и не включены в него.
              </p>
              {view.analysis.limitations.length ? (
                <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#6f7282]">
                  {view.analysis.limitations.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="Поиск по домену и характеристикам"
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                setVisibleCount(PAGE_CHUNK);
              }}
              placeholder="Домен, тематика, регион…"
              className={`${input} min-w-[220px] flex-1`}
            />
            <select
              aria-label="Сортировка заявок"
              value={sort}
              onChange={e => {
                setSort(e.target.value);
                setVisibleCount(PAGE_CHUNK);
              }}
              className={input}
            >
              <option value="recommendations">Рекомендации и траст</option>
              <option value="price">Цена по возрастанию</option>
              <option value="trust">Траст по убыванию</option>
              <option value="traffic">Трафик по убыванию</option>
            </select>
          </div>
          {visibleRows.length ? (
            <div className="overflow-x-auto rounded-3xl border border-[#ececf4] bg-white">
              <table className="w-full min-w-[900px] text-left text-[13px]">
                <thead className="bg-[#fafbff] text-[#6f7282]">
                  <tr>
                    {["Площадка", "Размещение", "Цена", "Трафик/сутки", "TF / CF", "ИКС", "Траст", "Диспетчер"].map(label => (
                      <th key={label} className="px-4 py-3 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(a => {
                    const r = recommendations.get(a.siteId);
                    const { thread: linkedThread } = getApplicationThreadPriority(a, threads);
                    return (
                      <tr key={a.id} className="border-t border-[#ececf4] align-top text-[#0b1024]">
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button type="button" disabled={busy} onClick={() => void openCard(a)} className="text-left font-medium text-[#3848c7] hover:underline">
                              {a.domain}
                            </button>
                            {linkedThread ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onJumpToThread
                                    ? onJumpToThread(linkedThread.id, a.domain)
                                    : void openCard(a)
                                }
                                className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 hover:bg-emerald-100"
                                title={linkedThread.lastMessagePreview ?? "Есть переписка с вебмастером"}
                              >
                                <MessageSquare className="size-3" />
                                {linkedThread.unreadCount > 0
                                  ? `Ответ в чате (${linkedThread.unreadCount})`
                                  : linkedThread.needsReply
                                    ? "Ждёт ответа"
                                    : "В диалоге"}
                              </button>
                            ) : null}
                          </div>
                          {a.badges.map(b => (
                            <div key={b} className="mt-1 max-w-[230px] text-[11px] text-[#6f7282]">
                              {b}
                            </div>
                          ))}
                        </td>
                        <td className="px-4 py-3">{a.placementType}</td>
                        <td className="px-4 py-3 whitespace-nowrap tabular-nums">{metric(a.priceRub)} ₽</td>
                        <td className="px-4 py-3 tabular-nums">{metric(a.dailyTraffic)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {metric(a.tf)} / {metric(a.cf)}
                        </td>
                        <td className="px-4 py-3">{metric(a.iks)}</td>
                        <td className="px-4 py-3">{metric(a.trust)}</td>
                        <td className="max-w-[310px] px-4 py-3">
                          {r ? (
                            <div className="space-y-1.5">
                              <span
                                className={`font-medium ${
                                  r.verdict === "recommended" ? "text-[#116b2a]" : r.verdict === "avoid" ? "text-[#a13a32]" : "text-[#3848c7]"
                                }`}
                              >
                                {verdicts[r.verdict]}
                              </span>
                              <p className="text-[12px] leading-relaxed text-[#6f7282]">{r.reason}</p>
                              {r.verdict !== "avoid" ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void openCard(a)}
                                  className="inline-flex items-center gap-1 text-[12px] font-medium text-[#5566f6] hover:underline"
                                >
                                  Подготовить статью и заказать →
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-[#9b9fb3]">{view.analysis ? "Вне короткого списка" : "Анализ не выполнен"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center text-[14px] text-[#6f7282]">
              {query ? "По вашему запросу ничего не найдено" : "Входящих заявок в этой кампании пока нет"}
            </div>
          )}
          {hasMore ? (
            <div ref={loadMoreRef} className="flex items-center justify-center py-2">
              <button
                type="button"
                className={button}
                onClick={() => setVisibleCount(current => Math.min(rows.length, current + PAGE_CHUNK))}
              >
                Показать ещё ({Math.min(PAGE_CHUNK, rows.length - visibleCount)} из {rows.length - visibleCount})
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      <Dialog
        open={!!selected}
        onOpenChange={open => {
          if (!open) {
            setSelected(null);
            setDraft(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl border-[#ececf4] bg-white sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle className="text-[#0b1024]">{selected?.domain}</DialogTitle>
            <DialogDescription>Характеристики площадки, примеры и оформление размещения в GoGetLinks.</DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 text-[13px] text-[#6f7282]">
                <span>
                  {selected.placementType} · предложение {metric(selected.priceRub)} ₽
                </span>
                <a href={selected.siteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#3848c7]">
                  Открыть сайт
                  <ExternalLink className="size-3" />
                </a>
              </div>
              {selectedRecommendation ? (
                <p className="rounded-2xl bg-[#eef1ff] p-3 text-[13px] leading-relaxed text-[#3848c7]">
                  {verdicts[selectedRecommendation.verdict]}: {selectedRecommendation.reason}
                </p>
              ) : null}

              <section className="space-y-3 rounded-2xl border border-[#dcdfed] bg-[#f8f9ff] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[14px] font-semibold text-[#0b1024]">Оформление размещения</h3>
                  <span className="text-[12px] text-[#6f7282]">
                    Списание только после нажатия «Отправить заявку»
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    aria-label="Посадочная страница wesetup.ru"
                    value={targetUrl}
                    disabled={drafting || submittingOrder}
                    onChange={e => {
                      const nextUrl = e.target.value;
                      setTargetUrl(nextUrl);
                      const preset = TARGET_PRESETS.find(p => p.url === nextUrl);
                      if (preset) setAnchor(preset.defaultAnchor);
                    }}
                    className={cn(input, "w-full")}
                  >
                    {TARGET_PRESETS.map(p => (
                      <option key={p.url} value={p.url}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Анкор ссылки"
                    value={anchor}
                    disabled={drafting || submittingOrder}
                    onChange={e => setAnchor(e.target.value)}
                    placeholder="Анкор ссылки (например, электронные журналы ХАССП)"
                    className={cn(input, "w-full")}
                  />
                </div>
                {(() => {
                  const activePreset = TARGET_PRESETS.find(p => p.url === targetUrl);
                  if (!activePreset?.anchorOptions.length) return null;
                  return (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                      <span className="text-[#6f7282]">Регламент анкоров:</span>
                      {activePreset.anchorOptions.map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={drafting || submittingOrder}
                          onClick={() => setAnchor(opt.value)}
                          className={cn(
                            "rounded-xl border px-2.5 py-1 transition-colors",
                            anchor === opt.value
                              ? "border-[#5566f6] bg-[#eef1ff] font-medium text-[#3848c7]"
                              : "border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#f5f6ff]",
                          )}
                        >
                          <span className="text-[#6f7282]">{opt.kind}:</span> «{opt.value}»
                        </button>
                      ))}
                    </div>
                  );
                })()}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={drafting || submittingOrder}
                    onClick={() => void handleGenerateDraft()}
                    className={cn(button, "border-[#5566f6] bg-white text-[#3848c7] hover:bg-[#eef1ff]")}
                  >
                    {drafting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    {selectedFormat === "article" ? "Сгенерировать статью ИИ" : "Сгенерировать ТЗ ИИ"}
                  </button>
                  {!draft && selectedFormat === "article" ? (
                    <button
                      type="button"
                      disabled={drafting || submittingOrder}
                      onClick={() =>
                        setDraft({
                          title: "",
                          announcement: "",
                          bodyHtml: `<p>Практический материал для ${selected.domain}, в котором органично размещена ссылка <a href="${targetUrl}">${anchor}</a>.</p>`,
                          metaTitle: "",
                          metaDescription: "",
                          metaKeywords: anchor,
                          briefText: UNIFIED_BRIEF_TEXT,
                        })
                      }
                      className={button}
                    >
                      <FileText className="size-4" />
                      Заполнить вручную
                    </button>
                  ) : null}
                </div>
                {draft ? (
                  <div className="space-y-2.5 pt-1">
                    {selectedFormat === "article" ? (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[12px] font-medium text-[#6f7282]">
                            Текст статьи со встроенной ссылкой
                          </span>
                          <div className="inline-flex rounded-xl border border-[#dcdfed] bg-white p-0.5">
                            <button
                              type="button"
                              onClick={() => setEditorMode("preview")}
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors",
                                editorMode === "preview"
                                  ? "bg-[#eef1ff] text-[#3848c7]"
                                  : "text-[#6f7282] hover:text-[#0b1024]",
                              )}
                            >
                              <Eye className="size-3.5" />
                              Предпросмотр в HTML
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditorMode("html")}
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors",
                                editorMode === "html"
                                  ? "bg-[#eef1ff] text-[#3848c7]"
                                  : "text-[#6f7282] hover:text-[#0b1024]",
                              )}
                            >
                              <Code2 className="size-3.5" />
                              HTML-код
                            </button>
                          </div>
                        </div>
                        <input
                          aria-label="Заголовок статьи"
                          value={draft.title}
                          disabled={submittingOrder}
                          onChange={e => setDraft({ ...draft, title: e.target.value })}
                          placeholder="Заголовок статьи"
                          className={cn(input, "w-full font-medium")}
                        />
                        {editorMode === "preview" ? (
                          <div className="max-h-[320px] overflow-y-auto rounded-2xl border border-[#dcdfed] bg-white p-4">
                            {draft.title ? (
                              <h4 className="mb-3 text-[16px] font-semibold text-[#0b1024]">
                                {draft.title}
                              </h4>
                            ) : null}
                            <div
                              className="prose prose-sm max-w-none text-[13.5px] leading-relaxed text-[#0b1024] [&_a]:font-semibold [&_a]:text-[#3848c7] [&_a]:underline [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-[15.5px] [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-[14px] [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-2.5"
                              dangerouslySetInnerHTML={{
                                __html: sanitizeArticleHtmlForPreview(draft.bodyHtml),
                              }}
                            />
                          </div>
                        ) : (
                          <textarea
                            aria-label="HTML-текст статьи"
                            rows={8}
                            value={draft.bodyHtml}
                            disabled={submittingOrder}
                            onChange={e => setDraft({ ...draft, bodyHtml: e.target.value })}
                            placeholder="HTML-текст статьи со встроенной ссылкой <a href=&quot;...&quot;>анкор</a>"
                            className="w-full rounded-2xl border border-[#dcdfed] bg-white p-3 font-mono text-[12.5px] leading-relaxed text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
                          />
                        )}
                      </>
                    ) : null}
                    <input
                      aria-label="Комментарий и ТЗ вебмастеру"
                      value={draft.briefText}
                      disabled={submittingOrder}
                      onChange={e => setDraft({ ...draft, briefText: e.target.value })}
                      placeholder="Комментарий и ТЗ для вебмастера"
                      className={cn(input, "w-full")}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-[#116b2a]">
                        <CheckCircle2 className="size-4" />
                        Ссылка: {targetUrl} · анкор «{anchor}»
                      </span>
                      <button
                        type="button"
                        disabled={submittingOrder || drafting}
                        onClick={() => void handleSubmitOrder()}
                        className={cn(button, "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]")}
                      >
                        {submittingOrder ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                        Отправить заявку вебмастеру · {metric(selected.priceRub)} ₽
                      </button>
                    </div>
                  </div>
                ) : selectedFormat !== "article" ? (
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      disabled={submittingOrder || drafting}
                      onClick={() => void handleSubmitOrder()}
                      className={cn(button, "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]")}
                    >
                      {submittingOrder ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                      Отправить заявку вебмастеру · {metric(selected.priceRub)} ₽
                    </button>
                  </div>
                ) : null}
              </section>

              {busy && !card ? (
                <p role="status" className="text-[13px] text-[#6f7282]">
                  Загружаем полную карточку…
                </p>
              ) : null}
              {cardResult?.error ? (
                <div className="space-y-2">
                  <p role="alert" className="text-[13px] text-[#a13a32]">
                    {cardResult.error}
                  </p>
                  <button type="button" disabled={busy} onClick={() => void openCard(selected)} className={button}>
                    Повторить загрузку
                  </button>
                </div>
              ) : null}
              {card ? (
                <>
                  {[...new Set(card.fields.map(f => f.group))].map(group => (
                    <section key={group} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
                      <h3 className="mb-3 text-[14px] font-semibold text-[#0b1024]">{group || "Характеристики"}</h3>
                      <dl className="space-y-2">
                        {card.fields
                          .filter(f => f.group === group)
                          .map((f, i) => (
                            <div key={i} className="flex justify-between gap-5 text-[13px]">
                              <dt className="text-[#6f7282]">{f.label}</dt>
                              <dd className="max-w-[65%] text-right text-[#0b1024]">{f.value}</dd>
                            </div>
                          ))}
                      </dl>
                    </section>
                  ))}
                  {card.examples.length ? (
                    <section>
                      <h3 className="mb-2 text-[14px] font-semibold text-[#0b1024]">Примеры размещения</h3>
                      <ul className="space-y-2">
                        {card.examples.map((url, i) => (
                          <li key={url}>
                            <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-[13px] text-[#3848c7] hover:underline">
                              Пример {i + 1}: {url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  <p className="text-[12px] text-[#6f7282]">
                    Источник: GoGetLinks · {new Date(card.fetchedAt).toLocaleString("ru-RU")}. Сведения о владельце, которых нет в карточке сервиса, не подставляются.
                  </p>
                </>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Copy,
  ExternalLink,
  Flame,
  FolderTree,
  Globe,
  ImageUp,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import type { ScoredTargetPage } from "@/lib/seo/gogetlinks-planner";
import { badgeToneClass } from "@/lib/seo/gogetlinks-ui-format";
import {
  type CompetitorBenchmarkVerdict,
  decodeSimilarwebClustersPayload,
} from "@/lib/seo/similarweb-client";
import {
  SEO_BTN_OUTLINE_CLASS,
  SEO_BTN_PRIMARY_CLASS,
  SEO_BTN_SM_CLASS,
  SEO_CARD_CLASS,
  SEO_INPUT_CLASS,
  SEO_TEXTAREA_CLASS,
  shortWesetupPath,
  type SimilarwebClusterDto,
  type SimilarwebMatrixResponse,
  type SimilarwebSnapshotDto,
} from "./types";

export interface SimilarwebCompetitorsWorkspaceProps {
  initialSnapshots?: SimilarwebSnapshotDto[];
  onAfterChange?: () => Promise<void> | void;
}

type VerdictFilterKey = "all" | CompetitorBenchmarkVerdict;
type ChannelFilterKey = "all" | "organic" | "paid";

function parseClusters(raw: unknown): SimilarwebClusterDto[] {
  const { clusters } = decodeSimilarwebClustersPayload(raw);
  return clusters;
}

function formatPriorityTier(tier: ScoredTargetPage["priorityTier"]): {
  label: string;
  tone: "indigo" | "emerald" | "amber" | "slate";
} {
  switch (tier) {
    case "push_top3":
      return { label: "Дожим ТОП-3", tone: "indigo" };
    case "zero_links":
      return { label: "0 ссылок", tone: "amber" };
    case "growth":
      return { label: "Усиление", tone: "emerald" };
    case "baseline":
    default:
      return { label: "Базовый", tone: "slate" };
  }
}

function formatVerdictTone(
  verdict: CompetitorBenchmarkVerdict,
): "indigo" | "emerald" | "amber" | "rose" | "slate" {
  switch (verdict) {
    case "leader":
      return "emerald";
    case "push_top3":
      return "indigo";
    case "gap_no_rank":
      return "amber";
    case "need_links":
      return "rose";
    case "parity":
    default:
      return "slate";
  }
}

export function SimilarwebCompetitorsWorkspace({
  initialSnapshots = [],
  onAfterChange,
}: SimilarwebCompetitorsWorkspaceProps) {
  const [matrixData, setMatrixData] = useState<SimilarwebMatrixResponse | null>(
    null,
  );
  const [loadingMatrix, setLoadingMatrix] = useState(false);

  const [uploadingOcr, setUploadingOcr] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [apiDomainInput, setApiDomainInput] = useState("rushaccp.ru");
  const [syncingApiDomain, setSyncingApiDomain] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{
    active: boolean;
    targetLabel: string;
    stepIndex: number;
    startedAtMs: number;
    elapsedSec: number;
    completedCount: number | null;
    error: string | null;
  } | null>(null);
  const [swSettingsOpen, setSwSettingsOpen] = useState(false);
  const [swCookieInput, setSwCookieInput] = useState("");
  const [swApiKeyInput, setSwApiKeyInput] = useState("");
  const [savingSwConn, setSavingSwConn] = useState(false);

  const [verdictFilter, setVerdictFilter] = useState<VerdictFilterKey>("all");
  const [channelFilter, setChannelFilter] = useState<ChannelFilterKey>("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [risingOnlyFilter, setRisingOnlyFilter] = useState(false);
  const [exclusiveOnlyFilter, setExclusiveOnlyFilter] = useState(false);
  const [keywordSearch, setKeywordSearch] = useState("");
  const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>({});
  const [showDetailedMatrix, setShowDetailedMatrix] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualDomain, setManualDomain] = useState("haccp-online.ru");
  const [manualPeriod, setManualPeriod] = useState("Oct–Dec 2026");
  const [manualVisits, setManualVisits] = useState("18500");
  const [manualOrganicPct, setManualOrganicPct] = useState("62");
  const [manualPaidPct, setManualPaidPct] = useState("24");
  const [manualClusters, setManualClusters] = useState<
    Array<{
      phrase: string;
      trafficSharePct: string;
      channel: "organic" | "paid";
      mappedTargetUrl: string;
    }>
  >([
    {
      phrase: "бракеражный журнал готовой продукции",
      trafficSharePct: "15",
      channel: "organic",
      mappedTargetUrl: "/journals-info/finished_product",
    },
  ]);
  const [savingManual, setSavingManual] = useState(false);

  const loadMatrix = useCallback(async () => {
    setLoadingMatrix(true);
    try {
      const response = await fetch("/api/root/gogetlinks/similarweb");
      const data = (await response.json().catch(() => null)) as
        | (SimilarwebMatrixResponse & { error?: string })
        | null;
      if (!response.ok || !data) {
        throw new Error(
          data?.error ??
            "Не удалось загрузить срезы Similarweb и сверку с конкурентами",
        );
      }
      setMatrixData(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Ошибка загрузки данных Similarweb",
      );
    } finally {
      setLoadingMatrix(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) {
        await loadMatrix();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMatrix]);

  const snapshots = matrixData?.snapshots ?? initialSnapshots;
  const priorityMatrix = matrixData?.priorityMatrix ?? [];
  const benchmark = matrixData?.benchmark ?? null;
  const swConn = matrixData?.similarwebConnection ?? null;

  const clustersByDomain = useMemo(() => {
    const map = new Map<string, SimilarwebClusterDto[]>();
    for (const snap of snapshots) {
      const d = snap.domain.trim().toLowerCase();
      if (!map.has(d)) {
        map.set(d, parseClusters(snap.clusters));
      }
    }
    return map;
  }, [snapshots]);

  const filteredGaps = useMemo(() => {
    const allGaps = benchmark?.clusterGaps ?? [];
    const q = keywordSearch.trim().toLowerCase();
    return allGaps.filter((row) => {
      if (verdictFilter !== "all" && row.verdict !== verdictFilter) return false;
      if (channelFilter !== "all" && row.competitorChannel !== channelFilter) {
        return false;
      }
      if (domainFilter !== "all" && row.competitorDomain !== domainFilter) {
        return false;
      }
      if (risingOnlyFilter && !(row.changePct !== null && row.changePct > 0)) {
        return false;
      }
      if (exclusiveOnlyFilter && !row.isExclusiveToCompetitors) {
        return false;
      }
      if (
        q &&
        !row.phrase.toLowerCase().includes(q) &&
        !row.mappedTargetUrl.toLowerCase().includes(q) &&
        !row.competitorDomain.toLowerCase().includes(q) &&
        !(row.competitorUrl ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [
    benchmark,
    verdictFilter,
    channelFilter,
    domainFilter,
    risingOnlyFilter,
    exclusiveOnlyFilter,
    keywordSearch,
  ]);

  const competitorDomains = useMemo(() => {
    return (benchmark?.domains ?? [])
      .filter((d) => !d.isWesetup)
      .map((d) => d.domain);
  }, [benchmark]);

  async function notifyChange() {
    await Promise.all([loadMatrix(), onAfterChange?.()]);
  }

  useEffect(() => {
    if (!syncProgress?.active) return;
    const timer = window.setInterval(() => {
      setSyncProgress((prev) => {
        if (!prev || !prev.active) return prev;
        const elapsedSec = Math.max(
          1,
          Math.floor((Date.now() - prev.startedAtMs) / 1000),
        );
        const stepIndex =
          elapsedSec < 2 ? 0 : elapsedSec < 4 ? 1 : elapsedSec < 7 ? 2 : 3;
        return { ...prev, elapsedSec, stepIndex };
      });
    }, 800);
    return () => window.clearInterval(timer);
  }, [syncProgress?.active]);

  async function handleSyncViaApiAnything(domainsToSync: string[]) {
    const cleanList = domainsToSync
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (cleanList.length === 0) {
      toast.error("Укажите домен конкурента");
      return;
    }

    const label = cleanList.length === 1 ? cleanList[0]! : "all";
    const displayLabel =
      cleanList.length === 1
        ? cleanList[0]!
        : `${cleanList.length} доменов (${cleanList.join(", ")})`;
    setSyncingApiDomain(label);
    setSyncProgress({
      active: true,
      targetLabel: displayLabel,
      stepIndex: 0,
      startedAtMs: Date.now(),
      elapsedSec: 0,
      completedCount: null,
      error: null,
    });
    try {
      const response = await fetch("/api/root/gogetlinks/similarweb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync_domain",
          domains: cleanList,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        snapshot?: SimilarwebSnapshotDto | null;
        snapshots?: SimilarwebSnapshotDto[];
        error?: string;
        code?: string;
      } | null;
      if (!response.ok || (!data?.snapshot && !data?.snapshots?.length)) {
        if (data?.code === "blocked" || data?.code === "SIMILARWEB_AUTH") {
          setSwSettingsOpen(true);
        }
        throw new Error(
          data?.error ?? "Не удалось загрузить срез конкурента",
        );
      }
      const syncedCount = data.snapshots?.length ?? 1;
      setSyncProgress((prev) =>
        prev
          ? {
              ...prev,
              active: false,
              stepIndex: 4,
              completedCount: syncedCount,
              error: null,
            }
          : null,
      );
      toast.success(
        syncedCount > 1
          ? `Обновлено доменов: ${syncedCount}`
          : `Домен ${data.snapshot?.domain} проанализирован`,
      );
      await notifyChange();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Ошибка синхронизации домена";
      setSyncProgress((prev) =>
        prev ? { ...prev, active: false, error: msg } : null,
      );
      toast.error(msg);
    } finally {
      setSyncingApiDomain(null);
    }
  }

  async function handleSaveSwConnection(e: React.FormEvent, clear = false) {
    e.preventDefault();
    setSavingSwConn(true);
    try {
      const response = await fetch("/api/root/gogetlinks/similarweb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_connection",
          cookieInput: clear ? null : swCookieInput.trim() || undefined,
          apiKey: clear ? null : swApiKeyInput.trim() || undefined,
          clear,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          data?.error ?? "Не удалось сохранить параметры сессии Similarweb",
        );
      }
      setSwCookieInput("");
      setSwApiKeyInput("");
      toast.success(
        clear ? "Сессия Similarweb очищена" : "Сессия Similarweb сохранена",
      );
      await loadMatrix();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Ошибка сохранения сессии",
      );
    } finally {
      setSavingSwConn(false);
    }
  }

  async function handleOcrFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const form = new FormData();
    for (const f of files) {
      form.append("images", f);
    }

    setUploadingOcr(true);
    try {
      const response = await fetch("/api/root/gogetlinks/similarweb", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => null)) as {
        snapshot?: SimilarwebSnapshotDto;
        error?: string;
      } | null;
      if (!response.ok || !data?.snapshot) {
        throw new Error(
          data?.error ?? "Не удалось распознать скриншот Similarweb",
        );
      }
      toast.success(
        `Скриншот ${data.snapshot.domain} (${data.snapshot.periodLabel}) распознан`,
      );
      await notifyChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка распознавания");
    } finally {
      setUploadingOcr(false);
    }
  }

  async function handleManualImport(e: React.FormEvent) {
    e.preventDefault();
    const visits = Number.parseInt(manualVisits, 10);
    if (!Number.isFinite(visits) || visits < 0) {
      toast.error("Укажите число визитов в месяц");
      return;
    }

    const clusters = manualClusters
      .filter((c) => c.phrase.trim() && c.mappedTargetUrl.trim())
      .map((c) => ({
        phrase: c.phrase.trim(),
        trafficSharePct: Math.max(
          0,
          Math.min(100, Number.parseFloat(c.trafficSharePct) || 0),
        ),
        channel: c.channel,
        mappedTargetUrl: c.mappedTargetUrl.trim(),
      }));

    setSavingManual(true);
    try {
      const response = await fetch("/api/root/gogetlinks/similarweb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: manualDomain.trim(),
          periodLabel: manualPeriod.trim(),
          visitsMonthly: visits,
          organicSharePct: manualOrganicPct
            ? Number.parseFloat(manualOrganicPct)
            : null,
          paidSharePct: manualPaidPct ? Number.parseFloat(manualPaidPct) : null,
          sourceKind: "manual",
          clusters,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        snapshot?: SimilarwebSnapshotDto;
        error?: string;
      } | null;
      if (!response.ok || !data?.snapshot) {
        throw new Error(data?.error ?? "Не удалось сохранить срез");
      }
      toast.success(
        `Срез ${data.snapshot.domain} (${data.snapshot.periodLabel}) сохранён`,
      );
      setManualOpen(false);
      await notifyChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка импорта среза");
    } finally {
      setSavingManual(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Compact Toolbar: Add / Sync Competitor Domain */}
      <section className={SEO_CARD_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-[#0b1024]">
              Домен:
            </span>
            <input
              type="text"
              value={apiDomainInput}
              onChange={(e) => setApiDomainInput(e.target.value)}
              placeholder="rushaccp.ru"
              className={`${SEO_INPUT_CLASS} !h-9 !w-48 !text-[13px]`}
            />
            <button
              type="button"
              disabled={syncingApiDomain !== null}
              onClick={() => void handleSyncViaApiAnything([apiDomainInput])}
              className={`${SEO_BTN_PRIMARY_CLASS} !h-9 !px-3.5 !text-[13px]`}
            >
              {syncingApiDomain === apiDomainInput.trim().toLowerCase() ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Проверить
            </button>

            <div className="hidden h-5 w-px bg-[#dcdfed] sm:block" />

            {(
              [
                "wesetup.ru",
                "haccp-online.ru",
                "checkoffice.ru",
                "rushaccp.ru",
              ] as const
            ).map((presetDomain) => (
              <button
                key={presetDomain}
                type="button"
                disabled={syncingApiDomain !== null}
                onClick={() => {
                  setApiDomainInput(presetDomain);
                  void handleSyncViaApiAnything([presetDomain]);
                }}
                className="inline-flex h-8 items-center rounded-xl border border-[#dcdfed] bg-[#fafbff] px-2.5 text-[12px] font-medium text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50"
              >
                {presetDomain}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => void handleOcrFilesSelected(e)}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploadingOcr}
              onClick={() => fileInputRef.current?.click()}
              className={SEO_BTN_SM_CLASS}
            >
              {uploadingOcr ? (
                <Loader2 className="size-3.5 animate-spin text-[#5566f6]" />
              ) : (
                <ImageUp className="size-3.5 text-[#5566f6]" />
              )}
              {uploadingOcr ? "OCR…" : "Скриншот"}
            </button>

            <button
              type="button"
              onClick={() => setManualOpen((v) => !v)}
              className={SEO_BTN_SM_CLASS}
            >
              <Plus className="size-3.5" />
              Вручную
            </button>

            <button
              type="button"
              onClick={() => setSwSettingsOpen((v) => !v)}
              className={SEO_BTN_SM_CLASS}
            >
              <KeyRound className="size-3.5 text-[#6f7282]" />
              Куки / API
            </button>
          </div>
        </div>

        {/* Step-by-Step AI Agent Competitor Loader */}
        {syncProgress ? (
          <div className="mt-3.5 rounded-2xl border border-[#c7d2fe] bg-[#eef1ff]/60 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-[#0b1024]">
                {syncProgress.active ? (
                  <Loader2 className="size-3.5 animate-spin text-[#5566f6]" />
                ) : syncProgress.error ? (
                  <span className="text-[#b91c1c]">✕</span>
                ) : (
                  <Check className="size-3.5 text-[#116b2a]" />
                )}
                <span>
                  {syncProgress.active
                    ? `ИИ-агент проверяет сайт конкурента ${syncProgress.targetLabel} (${syncProgress.elapsedSec} сек)…`
                    : syncProgress.error
                      ? `Ошибка проверки ${syncProgress.targetLabel}: ${syncProgress.error}`
                      : `ИИ-агент проверил ${syncProgress.targetLabel} и обновил матрицу ключевиков и посадочных`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSyncProgress(null)}
                className="text-[11px] text-[#6f7282] hover:text-[#0b1024]"
              >
                Скрыть
              </button>
            </div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  idx: 0,
                  title: "1. Проверяет сайт конкурента",
                  desc: `Визиты, 6 каналов трафика, рефералы и разделы ${syncProgress.targetLabel}`,
                },
                {
                  idx: 1,
                  title: "2. Ключевики SEO + Директ",
                  desc: "Доли трафика, частотность Вордстат, CPC и растущие запросы",
                },
                {
                  idx: 2,
                  title: "3. Проверяет посадочные ссылки",
                  desc: "Сопоставление с каноническими URL wesetup.ru (200 OK) без редиректов",
                },
                {
                  idx: 3,
                  title: "4. Сверка позиций Topvisor",
                  desc: "Позиции Яндекс/Google и расчёт точек перехвата в план GGL",
                },
              ].map((step) => {
                const isDone =
                  !syncProgress.error &&
                  (syncProgress.completedCount !== null ||
                    syncProgress.stepIndex > step.idx);
                const isCurrent =
                  syncProgress.active && syncProgress.stepIndex === step.idx;
                return (
                  <div
                    key={step.idx}
                    className={`rounded-xl border px-2.5 py-1.5 text-[11px] ${
                      isCurrent
                        ? "border-[#5566f6] bg-white text-[#0b1024]"
                        : isDone
                          ? "border-[#bbf7d0] bg-[#ecfdf5]/80 text-[#0b1024]"
                          : "border-[#dcdfed]/80 bg-white/70 text-[#6f7282]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-semibold">
                      {isCurrent ? (
                        <Loader2 className="size-3 shrink-0 animate-spin text-[#5566f6]" />
                      ) : isDone ? (
                        <Check className="size-3 shrink-0 text-[#116b2a]" />
                      ) : (
                        <span className="inline-block size-1.5 rounded-full bg-[#c4c8db]" />
                      )}
                      <span className="truncate">{step.title}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[10.5px] text-[#6f7282]">
                      {step.desc}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Summary KPI Strip */}
        {benchmark ? (
          <div className="mt-3.5 grid grid-cols-2 gap-2 border-t border-[#ececf4] pt-3.5 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border border-[#dcdfed]/70 bg-[#fafbff] px-3 py-2">
              <div className="text-[11px] text-[#6f7282]">Конкурентов</div>
              <div className="text-[16px] font-semibold text-[#0b1024]">
                {benchmark.summary.totalCompetitors}{" "}
                <span className="text-[11.5px] font-normal text-[#6f7282]">
                  сайта
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-[#dcdfed]/70 bg-[#fafbff] px-3 py-2">
              <div className="text-[11px] text-[#6f7282]">Ключей в сверке</div>
              <div className="text-[16px] font-semibold text-[#0b1024]">
                {benchmark.summary.totalTrackedKeywords}{" "}
                <span className="text-[11.5px] font-normal text-[#6f7282]">
                  ({benchmark.summary.paidKeywordsCount} Директ)
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-[#dcdfed]/70 bg-[#fafbff] px-3 py-2">
              <div className="text-[11px] text-[#6f7282]">Дожим в ТОП-3</div>
              <div className="text-[16px] font-semibold text-[#3848c7]">
                {benchmark.summary.pushTop3Count}{" "}
                <span className="text-[11.5px] font-normal text-[#6f7282]">
                  поз. 4–30
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-[#dcdfed]/70 bg-[#fafbff] px-3 py-2">
              <div className="text-[11px] text-[#6f7282]">Не в ТОП-30</div>
              <div className="text-[16px] font-semibold text-[#d97706]">
                {benchmark.summary.gapNoRankCount}{" "}
                <span className="text-[11.5px] font-normal text-[#6f7282]">
                  точек роста
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-[#dcdfed]/70 bg-[#fafbff] px-3 py-2">
              <div className="text-[11px] text-[#6f7282]">Мы в ТОП-3</div>
              <div className="text-[16px] font-semibold text-[#116b2a]">
                {benchmark.summary.leaderCount}{" "}
                <span className="text-[11.5px] font-normal text-[#6f7282]">
                  лидеры
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-[#bbf7d0] bg-[#ecfdf5]/70 px-3 py-2">
              <div className="text-[11px] text-[#116b2a]">Потенциал перехвата</div>
              <div className="text-[16px] font-semibold text-[#116b2a]">
                +{benchmark.summary.totalPotentialMonthlyVisits.toLocaleString("ru-RU")}{" "}
                <span className="text-[11.5px] font-normal">виз./мес</span>
              </div>
            </div>
          </div>
        ) : null}

        {swSettingsOpen ? (
          <form
            method="post"
            onSubmit={(e) => void handleSaveSwConnection(e, false)}
            className="mt-4 space-y-3 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13px] font-semibold text-[#0b1024]">
                Сессия Similarweb (api-anything)
              </div>
              {swConn ? (
                <span
                  className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badgeToneClass(
                    swConn.configured ? "emerald" : "slate",
                  )}`}
                >
                  {swConn.configured
                    ? `Кук: ${swConn.cookieCount}`
                    : "Авторежим (Topvisor SERP + api-anything)"}
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="mb-1 block text-[11.5px] font-medium text-[#6f7282]">
                  Куки Similarweb (Cookie header или JSON)
                </label>
                <textarea
                  rows={2}
                  value={swCookieInput}
                  onChange={(e) => setSwCookieInput(e.target.value)}
                  placeholder="aws-waf-token=...; sw_Session=..."
                  className={SEO_TEXTAREA_CLASS}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] font-medium text-[#6f7282]">
                  REST API Key
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={swApiKeyInput}
                  onChange={(e) => setSwApiKeyInput(e.target.value)}
                  placeholder={
                    swConn?.hasApiKey ? "Ключ сохранён (•••)" : "api_key..."
                  }
                  className={SEO_INPUT_CLASS}
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              {swConn?.configured ? (
                <button
                  type="button"
                  disabled={savingSwConn}
                  onClick={(e) => void handleSaveSwConnection(e, true)}
                  className={SEO_BTN_OUTLINE_CLASS}
                >
                  Очистить
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setSwSettingsOpen(false)}
                className={SEO_BTN_OUTLINE_CLASS}
              >
                Закрыть
              </button>
              <button
                type="submit"
                disabled={savingSwConn}
                className={SEO_BTN_PRIMARY_CLASS}
              >
                <Save className="size-4" />
                Сохранить
              </button>
            </div>
          </form>
        ) : null}

        {manualOpen ? (
          <form
            method="post"
            onSubmit={(e) => void handleManualImport(e)}
            className="mt-4 space-y-3 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4"
          >
            <div className="text-[13px] font-semibold text-[#0b1024]">
              Ручной ввод среза конкурента
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label className="mb-1 block text-[11.5px] font-medium text-[#6f7282]">
                  Домен
                </label>
                <input
                  type="text"
                  required
                  value={manualDomain}
                  onChange={(e) => setManualDomain(e.target.value)}
                  className={SEO_INPUT_CLASS}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] font-medium text-[#6f7282]">
                  Период
                </label>
                <input
                  type="text"
                  required
                  value={manualPeriod}
                  onChange={(e) => setManualPeriod(e.target.value)}
                  className={SEO_INPUT_CLASS}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] font-medium text-[#6f7282]">
                  Визитов / мес
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  required
                  min={0}
                  value={manualVisits}
                  onChange={(e) => setManualVisits(e.target.value)}
                  className={SEO_INPUT_CLASS}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] font-medium text-[#6f7282]">
                  Органика (%)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.1"
                  value={manualOrganicPct}
                  onChange={(e) => setManualOrganicPct(e.target.value)}
                  className={SEO_INPUT_CLASS}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] font-medium text-[#6f7282]">
                  Платный поиск (%)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.1"
                  value={manualPaidPct}
                  onChange={(e) => setManualPaidPct(e.target.value)}
                  className={SEO_INPUT_CLASS}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-[#6f7282]">
                  Ключевые запросы и посадочные wesetup.ru
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setManualClusters((prev) => [
                      ...prev,
                      {
                        phrase: "",
                        trafficSharePct: "5",
                        channel: "organic",
                        mappedTargetUrl: "/journals-info",
                      },
                    ])
                  }
                  className={SEO_BTN_SM_CLASS}
                >
                  <Plus className="size-3.5" />
                  Добавить запрос
                </button>
              </div>
              {manualClusters.map((cluster, idx) => (
                <div key={idx} className="grid gap-2 sm:grid-cols-12">
                  <input
                    type="text"
                    placeholder="Поисковая фраза"
                    value={cluster.phrase}
                    onChange={(e) =>
                      setManualClusters((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, phrase: e.target.value } : row,
                        ),
                      )
                    }
                    className={`${SEO_INPUT_CLASS} sm:col-span-4`}
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.1"
                    placeholder="Доля %"
                    value={cluster.trafficSharePct}
                    onChange={(e) =>
                      setManualClusters((prev) =>
                        prev.map((row, i) =>
                          i === idx
                            ? { ...row, trafficSharePct: e.target.value }
                            : row,
                        ),
                      )
                    }
                    className={`${SEO_INPUT_CLASS} sm:col-span-2`}
                  />
                  <select
                    value={cluster.channel}
                    onChange={(e) =>
                      setManualClusters((prev) =>
                        prev.map((row, i) =>
                          i === idx
                            ? {
                                ...row,
                                channel:
                                  e.target.value === "paid"
                                    ? "paid"
                                    : "organic",
                              }
                            : row,
                        ),
                      )
                    }
                    className={`${SEO_INPUT_CLASS} sm:col-span-2`}
                  >
                    <option value="organic">Органика</option>
                    <option value="paid">Реклама</option>
                  </select>
                  <input
                    type="text"
                    placeholder="/journals-info/..."
                    value={cluster.mappedTargetUrl}
                    onChange={(e) =>
                      setManualClusters((prev) =>
                        prev.map((row, i) =>
                          i === idx
                            ? { ...row, mappedTargetUrl: e.target.value }
                            : row,
                        ),
                      )
                    }
                    className={`${SEO_INPUT_CLASS} sm:col-span-3`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setManualClusters((prev) =>
                        prev.length > 1
                          ? prev.filter((_, i) => i !== idx)
                          : prev,
                      )
                    }
                    className="inline-flex h-10 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#6f7282] hover:text-[#a13a32] sm:col-span-1"
                    aria-label="Удалить строку кластера"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setManualOpen(false)}
                className={SEO_BTN_OUTLINE_CLASS}
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={savingManual}
                className={SEO_BTN_PRIMARY_CLASS}
              >
                <Save className="size-4" />
                Сохранить срез
              </button>
            </div>
          </form>
        ) : null}
      </section>

      {/* SECTION 1: КАРТОЧКИ САЙТОВ (Трафик, 6 каналов Similarweb, Вовлечённость, ВСЕ ключевики, Топ страниц, Рефералы) */}
      {benchmark && benchmark.domains.length > 0 ? (
        <section className={SEO_CARD_CLASS}>
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              <BarChart3 className="size-4 text-[#5566f6]" />
              1. Сравнение сайтов Similarweb
            </div>

            <button
              type="button"
              disabled={syncingApiDomain !== null}
              onClick={() =>
                void handleSyncViaApiAnything([
                  "wesetup.ru",
                  "haccp-online.ru",
                  "checkoffice.ru",
                  "rushaccp.ru",
                ])
              }
              className={SEO_BTN_SM_CLASS}
            >
              {syncingApiDomain === "all" ? (
                <Loader2 className="size-3.5 animate-spin text-[#5566f6]" />
              ) : (
                <RefreshCw className="size-3.5 text-[#5566f6]" />
              )}
              Обновить все
            </button>
          </div>

          <div className="grid gap-3.5 md:grid-cols-2">
            {benchmark.domains.map((dom) => {
              const orgWidth = Math.max(0, Math.min(100, dom.organicSharePct ?? 0));
              const paidWidth = Math.max(
                0,
                Math.min(100 - orgWidth, dom.paidSharePct ?? 0),
              );
              const directWidth = Math.max(
                0,
                Math.min(100 - orgWidth - paidWidth, dom.directSharePct ?? 0),
              );
              const refWidth = Math.max(
                0,
                Math.min(
                  100 - orgWidth - paidWidth - directWidth,
                  dom.referralsSharePct ?? 0,
                ),
              );
              const otherWidth = Math.max(
                0,
                100 - orgWidth - paidWidth - directWidth - refWidth,
              );

              const allClusters = clustersByDomain.get(dom.domain) ?? [];
              const isExpanded = Boolean(expandedDomains[dom.domain]);
              const visibleClusters = isExpanded
                ? allClusters
                : allClusters.slice(0, 6);

              return (
                <div
                  key={dom.domain}
                  className={`flex flex-col justify-between rounded-2xl border p-3.5 ${
                    dom.isWesetup
                      ? "border-[#d8deff] bg-[#eef1ff]/45"
                      : "border-[#dcdfed] bg-[#fafbff]"
                  }`}
                >
                  <div>
                    {/* Header row */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[15.5px] font-semibold text-[#0b1024]">
                          {dom.domain}
                        </span>
                        {dom.isWesetup ? (
                          <span className="rounded-full bg-[#5566f6] px-2 py-0.5 text-[10.5px] font-medium text-white">
                            Наш сайт
                          </span>
                        ) : (
                          <span className="rounded-full border border-[#dcdfed] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#0b1024]">
                            {dom.visitsRatioVsWesetup}×
                          </span>
                        )}
                        {dom.countryRank ? (
                          <span className="rounded-full border border-[#dcdfed] bg-white px-2 py-0.5 text-[10.5px] text-[#6f7282]">
                            РФ #{dom.countryRank.toLocaleString("ru-RU")}
                          </span>
                        ) : null}
                        {dom.nonBrandedSharePct !== null ? (
                          <span
                            className="rounded-full border border-[#d8deff] bg-white px-2 py-0.5 text-[10.5px] font-medium text-[#3848c7]"
                            title="Доля небрендового и брендового поискового спроса"
                          >
                            Небренд {dom.nonBrandedSharePct}%
                          </span>
                        ) : null}
                      </div>
                      <span className="text-[11px] text-[#6f7282]">
                        {dom.periodLabel}
                      </span>
                    </div>

                    {/* Visits & Engagement Compact Strip */}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[20px] font-semibold text-[#0b1024]">
                          {dom.visitsMonthly.toLocaleString("ru-RU")}
                        </span>
                        <span className="text-[11.5px] text-[#6f7282]">
                          виз./мес
                        </span>
                        {dom.visitsTrendPct !== null && dom.visitsTrendPct !== 0 ? (
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${
                              dom.visitsTrendPct > 0
                                ? "bg-[#dcfce7] text-[#116b2a]"
                                : "bg-[#fee2e2] text-[#991b1b]"
                            }`}
                          >
                            {dom.visitsTrendPct > 0 ? `+${dom.visitsTrendPct}%` : `${dom.visitsTrendPct}%`}
                          </span>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {dom.avgVisitDurationFormatted ? (
                          <span className="rounded-lg border border-[#dcdfed]/80 bg-white px-2 py-0.5 text-[#3c4053]">
                            Время: <strong>{dom.avgVisitDurationFormatted}</strong>
                          </span>
                        ) : null}
                        {dom.pagesPerVisit !== null ? (
                          <span className="rounded-lg border border-[#dcdfed]/80 bg-white px-2 py-0.5 text-[#3c4053]">
                            Стр/виз: <strong>{dom.pagesPerVisit}</strong>
                          </span>
                        ) : null}
                        {dom.bouncePct !== null ? (
                          <span className="rounded-lg border border-[#dcdfed]/80 bg-white px-2 py-0.5 text-[#3c4053]">
                            Отказы: <strong>{dom.bouncePct}%</strong>
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Visual stacked channel bar (SEO / Paid / Direct / Referrals / Social) */}
                    <div className="mt-2.5">
                      <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#e4e7f5]">
                        {orgWidth > 0 ? (
                          <div
                            style={{ width: `${orgWidth}%` }}
                            className="bg-[#116b2a]"
                            title={`SEO Органика: ${orgWidth}%`}
                          />
                        ) : null}
                        {paidWidth > 0 ? (
                          <div
                            style={{ width: `${paidWidth}%` }}
                            className="bg-[#d97706]"
                            title={`Директ (Paid): ${paidWidth}%`}
                          />
                        ) : null}
                        {directWidth > 0 ? (
                          <div
                            style={{ width: `${directWidth}%` }}
                            className="bg-[#5566f6]"
                            title={`Прямые: ${directWidth}%`}
                          />
                        ) : null}
                        {refWidth > 0 ? (
                          <div
                            style={{ width: `${refWidth}%` }}
                            className="bg-[#0891b2]"
                            title={`Рефералы: ${refWidth}%`}
                          />
                        ) : null}
                        {otherWidth > 0 ? (
                          <div
                            style={{ width: `${otherWidth}%` }}
                            className="bg-[#8b92b2]"
                            title={`Соцсети / Прочие: ${otherWidth.toFixed(1)}%`}
                          />
                        ) : null}
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                        <span className="inline-flex items-center gap-1 text-[#0b1024]">
                          <span className="size-2 rounded-full bg-[#116b2a]" />
                          SEO:{" "}
                          <strong>
                            {dom.organicSharePct !== null
                              ? `${dom.organicSharePct}%`
                              : "—"}
                          </strong>{" "}
                          <span className="text-[#6f7282]">
                            (~{dom.estimatedOrganicVisits.toLocaleString("ru-RU")})
                          </span>
                        </span>

                        <span className="inline-flex items-center gap-1 text-[#0b1024]">
                          <span className="size-2 rounded-full bg-[#d97706]" />
                          Директ:{" "}
                          <strong>
                            {dom.paidSharePct !== null
                              ? `${dom.paidSharePct}%`
                              : "0%"}
                          </strong>{" "}
                          <span className="text-[#6f7282]">
                            (~{dom.estimatedPaidVisits.toLocaleString("ru-RU")})
                          </span>
                        </span>

                        {dom.directSharePct !== null ? (
                          <span className="inline-flex items-center gap-1 text-[#0b1024]">
                            <span className="size-2 rounded-full bg-[#5566f6]" />
                            Прямые: <strong>{dom.directSharePct}%</strong>
                          </span>
                        ) : null}

                        {dom.referralsSharePct !== null &&
                        dom.referralsSharePct > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[#0b1024]">
                            <span className="size-2 rounded-full bg-[#0891b2]" />
                            Рефералы: <strong>{dom.referralsSharePct}%</strong>
                          </span>
                        ) : null}

                        {dom.socialSharePct !== null && dom.socialSharePct > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[#6f7282]">
                            Соцсети: {dom.socialSharePct}%
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* All Search Keywords for this Domain */}
                    {allClusters.length > 0 ? (
                      <div className="mt-2.5 border-t border-[#dcdfed]/70 pt-2">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6f7282]">
                            Ключевики ({allClusters.length})
                          </span>
                          {allClusters.length > 6 ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedDomains((prev) => ({
                                  ...prev,
                                  [dom.domain]: !isExpanded,
                                }))
                              }
                              className="text-[11px] font-semibold text-[#3848c7] hover:underline"
                            >
                              {isExpanded
                                ? "Свернуть"
                                : `Все ${allClusters.length}`}
                            </button>
                          ) : null}
                        </div>

                        <div className="space-y-1">
                          {visibleClusters.map((cl, i) => {
                            const estVisits = Math.round(
                              (dom.visitsMonthly * cl.trafficSharePct) / 100,
                            );
                            return (
                              <div
                                key={`${cl.phrase}-${i}`}
                                className="flex items-center justify-between gap-2 rounded-lg bg-white/80 px-2 py-1 text-[11.5px]"
                              >
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span
                                    className={`inline-block rounded px-1.5 py-0.2 text-[10px] font-semibold ${
                                      cl.channel === "paid"
                                        ? "bg-[#fef3c7] text-[#b45309]"
                                        : "bg-[#dcfce7] text-[#116b2a]"
                                    }`}
                                  >
                                    {cl.channel === "paid" ? "CPC" : "SEO"}
                                  </span>
                                  <span
                                    className="truncate font-medium text-[#0b1024]"
                                    title={cl.phrase}
                                  >
                                    {cl.phrase}
                                  </span>
                                </div>

                                <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
                                  {cl.changePct !== null &&
                                  cl.changePct !== undefined &&
                                  cl.changePct > 0 ? (
                                    <span
                                      className="rounded bg-[#dcfce7] px-1 py-0.2 text-[10px] font-semibold text-[#116b2a]"
                                      title="Рост трафика по ключу в Similarweb"
                                    >
                                      +{cl.changePct}%
                                    </span>
                                  ) : null}
                                  {cl.volume ? (
                                    <span
                                      className="hidden rounded bg-[#f4f5fb] px-1.5 py-0.5 text-[10px] text-[#6f7282] sm:inline-block"
                                      title="Частотность Вордстат"
                                    >
                                      WS {cl.volume.toLocaleString("ru-RU")}
                                    </span>
                                  ) : null}
                                  <span className="font-semibold text-[#0b1024]">
                                    {cl.trafficSharePct}%
                                  </span>
                                  <span className="text-[#6f7282]">
                                    (~{estVisits.toLocaleString("ru-RU")})
                                  </span>
                                  <Link
                                    href={`/root/seo/links?targetUrl=${encodeURIComponent(
                                      cl.mappedTargetUrl,
                                    )}&keyword=${encodeURIComponent(cl.phrase)}`}
                                    className="font-medium text-[#3848c7] hover:underline"
                                    title={`Запланировать ссылку на ${cl.mappedTargetUrl}`}
                                  >
                                    → {shortWesetupPath(cl.mappedTargetUrl)}
                                  </Link>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* Compact Bottom Strip: Subfolders + Top Pages + Referrals + Similar Sites */}
                  {dom.topSubfolders.length > 0 ||
                  dom.topPages.length > 0 ||
                  dom.topReferrals.length > 0 ||
                  dom.similarSites.length > 0 ? (
                    <div className="mt-2.5 space-y-1.5 border-t border-[#dcdfed]/70 pt-2 text-[11px]">
                      {dom.topSubfolders.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="inline-flex items-center gap-0.5 font-semibold text-[#6f7282]">
                            <FolderTree className="size-3 text-[#5566f6]" />
                            Разделы:
                          </span>
                          {dom.topSubfolders.slice(0, 3).map((sf) => (
                            <span
                              key={sf.subfolder}
                              className="rounded-md border border-[#d8deff] bg-white px-1.5 py-0.5 text-[#3848c7]"
                            >
                              {sf.subfolder}{" "}
                              <strong className="text-[#0b1024]">
                                {sf.sharePct}%
                              </strong>
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {dom.topPages.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="font-semibold text-[#6f7282]">
                            Входы:
                          </span>
                          {dom.topPages.slice(0, 3).map((pg) => (
                            <button
                              key={pg.urlPath}
                              type="button"
                              onClick={() => {
                                setDomainFilter(dom.domain);
                                setKeywordSearch(
                                  pg.urlPath.split("/").filter(Boolean).pop() ??
                                    pg.urlPath,
                                );
                              }}
                              className="rounded-md border border-[#dcdfed]/80 bg-white px-1.5 py-0.5 text-[#3c4053] hover:border-[#5566f6]"
                              title="Фильтровать таблицу по этой посадочной конкурента"
                            >
                              {pg.urlPath}{" "}
                              <strong className="text-[#0b1024]">
                                {pg.sharePct}%
                              </strong>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {dom.topReferrals.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="font-semibold text-[#6f7282]">
                            Доноры:
                          </span>
                          {dom.topReferrals.slice(0, 4).map((ref) => (
                            <span
                              key={ref.domain}
                              className="rounded-md border border-[#bae6fd] bg-[#f0f9ff] px-1.5 py-0.5 text-[#0369a1]"
                            >
                              {ref.domain} <strong>{ref.sharePct}%</strong>
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {dom.similarSites.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="font-semibold text-[#6f7282]">
                            Похожие:
                          </span>
                          {dom.similarSites.slice(0, 4).map((sim) => (
                            <button
                              key={sim.domain}
                              type="button"
                              disabled={syncingApiDomain !== null}
                              onClick={() => {
                                setApiDomainInput(sim.domain);
                                void handleSyncViaApiAnything([sim.domain]);
                              }}
                              className="rounded-md border border-[#dcdfed] bg-white px-1.5 py-0.5 text-[#3848c7] hover:border-[#5566f6] hover:bg-[#f5f6ff]"
                              title="Нажмите, чтобы проанализировать домен"
                            >
                              {sim.domain}
                              {sim.affinityPct ? ` (${sim.affinityPct}%)` : ""}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Aggregated Similarweb Discovery Strip: Referrals (Link Donors) & Similar Competitors */}
          {benchmark.discoveredReferrals.length > 0 ||
          benchmark.discoveredSimilarSites.length > 0 ? (
            <div className="mt-3.5 grid gap-3 border-t border-[#ececf4] pt-3.5 md:grid-cols-2">
              {benchmark.discoveredReferrals.length > 0 ? (
                <div className="rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-3">
                  <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#0b1024]">
                    <Link2 className="size-3.5 text-[#0891b2]" />
                    Реферальные доноры
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {benchmark.discoveredReferrals.map((ref) => (
                      <span
                        key={ref.domain}
                        className="inline-flex items-center gap-1 rounded-xl border border-[#bae6fd] bg-white px-2.5 py-1 text-[11.5px] text-[#0b1024]"
                        title={`Даёт трафик на: ${ref.targetCompetitors.join(", ")}`}
                      >
                        <Globe className="size-3 text-[#0891b2]" />
                        <strong>{ref.domain}</strong>
                        <span className="text-[#0369a1]">{ref.sharePct}%</span>
                        <span className="text-[10.5px] text-[#6f7282]">
                          → {ref.targetCompetitors.join(", ")}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {benchmark.discoveredSimilarSites.length > 0 ? (
                <div className="rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-3">
                  <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#0b1024]">
                    <Compass className="size-3.5 text-[#5566f6]" />
                    Похожие сайты (Affinity)
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {benchmark.discoveredSimilarSites.map((sim) => (
                      <button
                        key={sim.domain}
                        type="button"
                        disabled={syncingApiDomain !== null}
                        onClick={() => {
                          setApiDomainInput(sim.domain);
                          void handleSyncViaApiAnything([sim.domain]);
                        }}
                        className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-[11.5px] transition-colors ${
                          sim.alreadyTracked
                            ? "border-[#d8deff] bg-[#eef1ff] text-[#3848c7]"
                            : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]"
                        }`}
                      >
                        <strong>{sim.domain}</strong>
                        {sim.affinityPct ? (
                          <span className="text-[11px] text-[#6f7282]">
                            {sim.affinityPct}%
                          </span>
                        ) : null}
                        {sim.alreadyTracked ? (
                          <span className="text-[10px] font-semibold text-[#116b2a]">
                            в базе
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-[#5566f6]">
                            + проверить
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* SECTION 2: БЫСТРЫЙ ПЛАН ДЕЙСТВИЙ (Компактные карточки без воды) */}
      {benchmark && benchmark.actionPlan && benchmark.actionPlan.length > 0 ? (
        <section className={SEO_CARD_CLASS}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              <Sparkles className="size-4 text-[#5566f6]" />
              2. Точки перехвата ({benchmark.actionPlan.length})
            </div>

            {benchmark.summary.totalPotentialMonthlyVisits > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#bbf7d0] bg-[#ecfdf5] px-3 py-0.5 text-[11.5px] font-semibold text-[#116b2a]">
                <Rocket className="size-3" />+
                {benchmark.summary.totalPotentialMonthlyVisits.toLocaleString(
                  "ru-RU",
                )}{" "}
                виз./мес
              </span>
            ) : null}
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {benchmark.actionPlan.map((act, index) => (
              <div
                key={act.id}
                className="flex flex-col justify-between rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-3"
              >
                <div>
                  <div className="flex items-center justify-between gap-1.5">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${badgeToneClass(
                        act.priority === "high" ? "indigo" : "amber",
                      )}`}
                    >
                      #{index + 1} · {act.badgeLabel}
                    </span>
                    <span className="text-[11.5px] font-semibold text-[#116b2a]">
                      +{act.potentialVisitsMonthly.toLocaleString("ru-RU")} виз.
                    </span>
                  </div>

                  <div className="mt-1.5 text-[13.5px] font-semibold text-[#0b1024]">
                    {act.title}
                  </div>

                  <div className="mt-0.5 text-[11.5px] text-[#6f7282]">
                    {act.whyText}
                    {act.volume
                      ? ` · WS ${act.volume.toLocaleString("ru-RU")}`
                      : ""}
                  </div>

                  <ul className="mt-2 space-y-1 border-t border-[#dcdfed]/70 pt-1.5 text-[11.5px] text-[#3c4053]">
                    {act.actionSteps.map((step, sIdx) => (
                      <li key={sIdx} className="truncate" title={step}>
                        • {step}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[#dcdfed]/70 pt-2">
                  <div className="flex items-center gap-2 text-[11px] text-[#6f7282]">
                    <a
                      href={`https://wesetup.ru${act.targetUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-[#3848c7] hover:underline"
                    >
                      {act.targetUrl}
                    </a>
                    <span>
                      Я:{act.yandexPos ?? "—"} · Ссыл:{act.purchasedLinksCount}
                    </span>
                  </div>

                  <Link
                    href={act.ctaHref}
                    className="inline-flex h-7 items-center gap-1 rounded-xl border border-[#d8deff] bg-[#eef1ff] px-2.5 text-[11px] font-semibold text-[#3848c7] hover:bg-[#dfe5ff]"
                  >
                    {act.ctaLabel}
                    <ArrowRight className="size-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* SECTION 3: ПОЛНАЯ ТАБЛИЦА ВСЕХ КЛЮЧЕВИКОВ КОНКУРЕНТОВ */}
      {benchmark && benchmark.clusterGaps.length > 0 ? (
        <section className={SEO_CARD_CLASS}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              <TrendingUp className="size-4 text-[#5566f6]" />
              3. Все ключевики конкурентов ({filteredGaps.length} из{" "}
              {benchmark.clusterGaps.length})
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-[#9b9fb3]" />
                <input
                  type="text"
                  value={keywordSearch}
                  onChange={(e) => setKeywordSearch(e.target.value)}
                  placeholder="Ключ или /url…"
                  className={`${SEO_INPUT_CLASS} !h-8 !w-48 !pl-8 !text-[12px]`}
                />
              </div>

              <select
                value={channelFilter}
                onChange={(e) =>
                  setChannelFilter(e.target.value as ChannelFilterKey)
                }
                className={`${SEO_INPUT_CLASS} !h-8 !w-36 !text-[12px]`}
              >
                <option value="all">Все каналы</option>
                <option value="paid">
                  Директ CPC ({benchmark.summary.paidKeywordsCount})
                </option>
                <option value="organic">
                  SEO Органика ({benchmark.summary.organicKeywordsCount})
                </option>
              </select>

              {competitorDomains.length > 1 ? (
                <select
                  value={domainFilter}
                  onChange={(e) => setDomainFilter(e.target.value)}
                  className={`${SEO_INPUT_CLASS} !h-8 !w-40 !text-[12px]`}
                >
                  <option value="all">Все конкуренты</option>
                  {competitorDomains.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  const header =
                    "Запрос\tКанал\tКонкурент\tДоля %\tВизитов/мес\tВордстат\tCPC $\tПосадочная wesetup.ru\tЯндекс\tGoogle\tСтатус";
                  const lines = filteredGaps.map((g) =>
                    [
                      g.phrase,
                      g.competitorChannel,
                      g.competitorDomain,
                      g.competitorTrafficSharePct,
                      g.estimatedMonthlyTraffic,
                      g.volume ?? "",
                      g.cpcUsd ?? "",
                      g.mappedTargetUrl,
                      g.yandexPos ?? "",
                      g.googlePos ?? "",
                      g.verdictLabel,
                    ].join("\t"),
                  );
                  void navigator.clipboard
                    .writeText([header, ...lines].join("\n"))
                    .then(() =>
                      toast.success(
                        `Скопировано ключей: ${filteredGaps.length} (TSV для Excel/Таблиц)`,
                      ),
                    )
                    .catch(() => toast.error("Не удалось скопировать"));
                }}
                className={SEO_BTN_SM_CLASS}
                title="Скопировать отфильтрованные ключи в буфер обмена (TSV)"
              >
                <Copy className="size-3.5 text-[#5566f6]" />
                Копировать TSV
              </button>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {(
              [
                {
                  key: "all",
                  label: `Все · ${benchmark.clusterGaps.length}`,
                },
                {
                  key: "push_top3",
                  label: `Дожим #4–30 · ${benchmark.summary.pushTop3Count}`,
                },
                {
                  key: "gap_no_rank",
                  label: `Не в ТОП-30 · ${benchmark.summary.gapNoRankCount}`,
                },
                {
                  key: "leader",
                  label: `Мы в ТОП-3 · ${benchmark.summary.leaderCount}`,
                },
              ] as Array<{ key: VerdictFilterKey; label: string }>
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setVerdictFilter(f.key)}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                  verdictFilter === f.key
                    ? "border-[#5566f6] bg-[#5566f6] text-white"
                    : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40"
                }`}
              >
                {f.label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setRisingOnlyFilter((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                risingOnlyFilter
                  ? "border-[#116b2a] bg-[#116b2a] text-white"
                  : "border-[#bbf7d0] bg-[#ecfdf5] text-[#116b2a] hover:border-[#116b2a]/50"
              }`}
            >
              <Flame className="size-3" />
              Растущие · {benchmark.summary.risingKeywordsCount}
            </button>

            <button
              type="button"
              onClick={() => setExclusiveOnlyFilter((v) => !v)}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                exclusiveOnlyFilter
                  ? "border-[#3848c7] bg-[#3848c7] text-white"
                  : "border-[#d8deff] bg-[#eef1ff] text-[#3848c7] hover:border-[#3848c7]/50"
              }`}
            >
              Только у конкурентов · {benchmark.summary.exclusiveKeywordsCount}
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[#ececf4]">
            <table className="w-full min-w-[980px] text-[12.5px]">
              <thead>
                <tr className="bg-[#fafbff] text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">
                  <th className="px-3.5 py-2.5">Ключевой запрос</th>
                  <th className="px-3.5 py-2.5">Конкурент / Доля</th>
                  <th className="px-3.5 py-2.5">Вордстат / CPC</th>
                  <th className="px-3.5 py-2.5">Посадочная wesetup.ru</th>
                  <th className="px-3.5 py-2.5">Позиции (Я / G)</th>
                  <th className="px-3.5 py-2.5">Статус и действие</th>
                </tr>
              </thead>
              <tbody>
                {filteredGaps.map((gap, idx) => (
                  <tr
                    key={`${gap.competitorDomain}:${gap.phrase}:${idx}`}
                    className="border-t border-[#ececf4] align-middle hover:bg-[#fafbff]/70"
                  >
                    <td className="px-3.5 py-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            gap.competitorChannel === "paid"
                              ? "bg-[#fef3c7] text-[#b45309]"
                              : "bg-[#dcfce7] text-[#116b2a]"
                          }`}
                        >
                          {gap.competitorChannel === "paid" ? "CPC" : "SEO"}
                        </span>
                        <span className="font-semibold text-[#0b1024]">
                          {gap.phrase}
                        </span>
                        {gap.changePct !== null && gap.changePct > 0 ? (
                          <span className="rounded bg-[#dcfce7] px-1 py-0.2 text-[10px] font-semibold text-[#116b2a]">
                            +{gap.changePct}%
                          </span>
                        ) : null}
                      </div>
                      {gap.competitorUrl ? (
                        <div
                          className="mt-0.5 max-w-[280px] truncate text-[11px] text-[#6f7282]"
                          title={gap.competitorUrl}
                        >
                          {gap.competitorPos ? `#${gap.competitorPos} · ` : ""}
                          {gap.competitorUrl.replace(/^https?:\/\//, "")}
                        </div>
                      ) : null}
                    </td>

                    <td className="whitespace-nowrap px-3.5 py-2">
                      <div className="font-medium text-[#0b1024]">
                        {gap.competitorDomain}
                      </div>
                      <div className="text-[11.5px] text-[#3848c7]">
                        <strong>{gap.competitorTrafficSharePct}%</strong> (~
                        {gap.estimatedMonthlyTraffic.toLocaleString("ru-RU")}{" "}
                        виз.)
                      </div>
                    </td>

                    <td className="whitespace-nowrap px-3.5 py-2">
                      <div className="font-semibold text-[#0b1024]">
                        {gap.volume
                          ? `${gap.volume.toLocaleString("ru-RU")} пок/мес`
                          : "—"}
                      </div>
                      {gap.cpcUsd ? (
                        <div className="text-[11px] text-[#6f7282]">
                          CPC ~${gap.cpcUsd}
                        </div>
                      ) : null}
                    </td>

                    <td className="whitespace-nowrap px-3.5 py-2">
                      <a
                        href={`https://wesetup.ru${gap.mappedTargetUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-[#3848c7] hover:underline"
                      >
                        {gap.mappedTargetUrl}
                        <ExternalLink className="size-3" />
                      </a>
                      <div className="text-[11px] text-[#6f7282]">
                        Ссылок: <strong>{gap.purchasedLinksCount}</strong>
                      </div>
                    </td>

                    <td className="whitespace-nowrap px-3.5 py-2">
                      <span className="font-semibold text-[#0b1024]">
                        {gap.yandexPos ? `#${gap.yandexPos}` : "—"}
                      </span>{" "}
                      <span className="text-[#9b9fb3]">/</span>{" "}
                      <span className="text-[#3c4053]">
                        {gap.googlePos ? `#${gap.googlePos}` : "—"}
                      </span>
                    </td>

                    <td className="px-3.5 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${badgeToneClass(
                            formatVerdictTone(gap.verdict),
                          )}`}
                        >
                          {gap.verdictLabel}
                        </span>
                        {gap.verdict !== "leader" ? (
                          <Link
                            href={`/root/seo/links?targetUrl=${encodeURIComponent(
                              gap.mappedTargetUrl,
                            )}&keyword=${encodeURIComponent(gap.phrase)}`}
                            className="inline-flex items-center gap-1 rounded-xl border border-[#d8deff] bg-[#eef1ff] px-2 py-0.5 text-[11px] font-semibold text-[#3848c7] hover:bg-[#dfe5ff]"
                          >
                            + Ссылка
                            <ArrowRight className="size-3" />
                          </Link>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#6f7282]">
                        {gap.recommendation}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* SECTION 4: Свернутая матрица посадочных wesetup.ru */}
      <section className={SEO_CARD_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Посадочные wesetup.ru ({priorityMatrix.length})
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loadingMatrix}
              onClick={() => void loadMatrix()}
              className={SEO_BTN_SM_CLASS}
            >
              <RefreshCw
                className={`size-3.5 ${loadingMatrix ? "animate-spin" : ""}`}
              />
              Обновить
            </button>
            <button
              type="button"
              onClick={() => setShowDetailedMatrix((v) => !v)}
              className={SEO_BTN_SM_CLASS}
            >
              {showDetailedMatrix ? (
                <>
                  <ChevronUp className="size-3.5" />
                  Скрыть
                </>
              ) : (
                <>
                  <ChevronDown className="size-3.5" />
                  Показать ({priorityMatrix.length})
                </>
              )}
            </button>
          </div>
        </div>

        {showDetailedMatrix ? (
          <div className="mt-3.5 overflow-x-auto rounded-2xl border border-[#ececf4]">
            <table className="w-full min-w-[900px] text-[12.5px]">
              <thead>
                <tr className="bg-[#fafbff] text-left text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                  <th className="px-3.5 py-2.5">Посадочная wesetup.ru</th>
                  <th className="px-3.5 py-2.5">Главный ключ</th>
                  <th className="px-3.5 py-2.5">Topvisor (Я / G)</th>
                  <th className="px-3.5 py-2.5">Ссылок</th>
                  <th className="px-3.5 py-2.5">Приоритет</th>
                </tr>
              </thead>
              <tbody>
                {priorityMatrix.slice(0, 30).map((row) => {
                  const tier = formatPriorityTier(row.priorityTier);
                  return (
                    <tr
                      key={row.targetUrl}
                      className="border-t border-[#ececf4] align-middle hover:bg-[#fafbff]/60"
                    >
                      <td className="max-w-[260px] px-3.5 py-2">
                        <a
                          href={`https://wesetup.ru${row.targetUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-[#3848c7] hover:underline"
                        >
                          {row.targetUrl}
                          <ExternalLink className="size-3" />
                        </a>
                        <div className="truncate text-[11px] text-[#6f7282]">
                          {row.title}
                        </div>
                      </td>

                      <td className="px-3.5 py-2">
                        <div className="font-medium text-[#0b1024]">
                          «{row.primaryKeyword}»
                        </div>
                        {row.competitorDomain ? (
                          <div className="text-[11px] text-[#6f7282]">
                            {row.competitorDomain} ·{" "}
                            {row.competitorTrafficSharePct}% (
                            {row.competitorChannel === "paid" ? "CPC" : "SEO"})
                          </div>
                        ) : null}
                      </td>

                      <td className="whitespace-nowrap px-3.5 py-2">
                        <span className="font-semibold text-[#0b1024]">
                          {row.yandexPos ?? "—"}
                        </span>{" "}
                        <span className="text-[#9b9fb3]">/</span>{" "}
                        <span className="text-[#3c4053]">
                          {row.googlePos ?? "—"}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-3.5 py-2 font-semibold text-[#0b1024]">
                        {row.existingLinksCount}
                      </td>

                      <td className="px-3.5 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${badgeToneClass(
                              tier.tone,
                            )}`}
                          >
                            {tier.label}
                          </span>
                          <span className="text-[11.5px] font-semibold text-[#0b1024]">
                            {Math.round(row.score)} балл.
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

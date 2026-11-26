"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ImageUp,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import type { ScoredTargetPage } from "@/lib/seo/gogetlinks-planner";
import { badgeToneClass } from "@/lib/seo/gogetlinks-ui-format";
import type { CompetitorBenchmarkVerdict } from "@/lib/seo/similarweb-client";
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

function parseClusters(raw: unknown): SimilarwebClusterDto[] {
  if (!Array.isArray(raw)) return [];
  const out: SimilarwebClusterDto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.phrase !== "string" || !rec.phrase.trim()) continue;
    out.push({
      phrase: rec.phrase.trim(),
      trafficSharePct: Number(rec.trafficSharePct ?? 0) || 0,
      channel: rec.channel === "paid" ? "paid" : "organic",
      mappedTargetUrl:
        typeof rec.mappedTargetUrl === "string"
          ? rec.mappedTargetUrl
          : "/journals-info",
      notes: typeof rec.notes === "string" ? rec.notes : undefined,
    });
  }
  return out;
}

function formatPriorityTier(tier: ScoredTargetPage["priorityTier"]): {
  label: string;
  tone: "indigo" | "emerald" | "amber" | "slate";
} {
  switch (tier) {
    case "push_top3":
      return { label: "Дожим в ТОП-3 (поз. 4–30)", tone: "indigo" };
    case "zero_links":
      return { label: "Стартовый вес (0 ссылок)", tone: "amber" };
    case "growth":
      return { label: "Усиление кластера", tone: "emerald" };
    case "baseline":
    default:
      return { label: "Базовый приоритет", tone: "slate" };
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
  const [swSettingsOpen, setSwSettingsOpen] = useState(false);
  const [swCookieInput, setSwCookieInput] = useState("");
  const [swApiKeyInput, setSwApiKeyInput] = useState("");
  const [savingSwConn, setSavingSwConn] = useState(false);

  const [verdictFilter, setVerdictFilter] = useState<VerdictFilterKey>("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
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
    return allGaps.filter((row) => {
      if (verdictFilter !== "all" && row.verdict !== verdictFilter) return false;
      if (domainFilter !== "all" && row.competitorDomain !== domainFilter) {
        return false;
      }
      return true;
    });
  }, [benchmark, verdictFilter, domainFilter]);

  const competitorDomains = useMemo(() => {
    return (benchmark?.domains ?? [])
      .filter((d) => !d.isWesetup)
      .map((d) => d.domain);
  }, [benchmark]);

  async function notifyChange() {
    await Promise.all([loadMatrix(), onAfterChange?.()]);
  }

  async function handleSyncViaApiAnything(domainsToSync: string[]) {
    const cleanList = domainsToSync
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (cleanList.length === 0) {
      toast.error("Укажите домен конкурента");
      return;
    }

    const label = cleanList.length === 1 ? cleanList[0] : "all";
    setSyncingApiDomain(label);
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
      toast.success(
        syncedCount > 1
          ? `Обновлено доменов: ${syncedCount}`
          : `Домен ${data.snapshot?.domain} проанализирован и добавлен в сверку`,
      );
      await notifyChange();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Ошибка синхронизации домена",
      );
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
        clear
          ? "Сессия Similarweb очищена"
          : "Сессия Similarweb сохранена",
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
    <div className="space-y-6">
      {/* Compact Toolbar: Add / Sync Competitor Domain */}
      <section className={SEO_CARD_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-[#0b1024]">
              Проверить конкурента:
            </span>
            <input
              type="text"
              value={apiDomainInput}
              onChange={(e) => setApiDomainInput(e.target.value)}
              placeholder="Например, rushaccp.ru"
              className={`${SEO_INPUT_CLASS} !h-9 !w-52 !text-[13px]`}
            />
            <button
              type="button"
              disabled={syncingApiDomain !== null}
              onClick={() => void handleSyncViaApiAnything([apiDomainInput])}
              className={SEO_BTN_PRIMARY_CLASS}
            >
              {syncingApiDomain === apiDomainInput.trim().toLowerCase() ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Анализировать домен
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
              {uploadingOcr ? "Распознаём…" : "Загрузить скриншот"}
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

        {swSettingsOpen ? (
          <form
            method="post"
            onSubmit={(e) => void handleSaveSwConnection(e, false)}
            className="mt-4 space-y-3 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-semibold text-[#0b1024]">
                  Дополнительные настройки api-anything (Similarweb)
                </div>
                <p className="mt-0.5 text-[12px] text-[#6f7282]">
                  Если Similarweb закрыт защитой CloudFront, система автоматически переключается на живую SERP-сверку через Topvisor и анализ структуры сайта конкурента.
                </p>
              </div>
              {swConn ? (
                <span
                  className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badgeToneClass(
                    swConn.configured ? "emerald" : "slate",
                  )}`}
                >
                  {swConn.configured
                    ? `Кук сохранено: ${swConn.cookieCount}`
                    : "Авторежим (Topvisor SERP + api-anything)"}
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="mb-1 block text-[11.5px] font-medium text-[#6f7282]">
                  Сессионные куки Similarweb (необязательно)
                </label>
                <textarea
                  rows={2}
                  value={swCookieInput}
                  onChange={(e) => setSwCookieInput(e.target.value)}
                  placeholder="Cookie header или JSON массив кук"
                  className={SEO_TEXTAREA_CLASS}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] font-medium text-[#6f7282]">
                  Similarweb REST API Key (необязательно)
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
                  Поисковые запросы и посадочные wesetup.ru
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

      {/* SECTION 1: КАНАЛЫ ПРИВЛЕЧЕНИЯ КОНКУРЕНТОВ (Простая и наглядная раскладка) */}
      {benchmark && benchmark.domains.length > 0 ? (
        <section className={SEO_CARD_CLASS}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                <BarChart3 className="size-4 text-[#5566f6]" />
                1. Каналы привлечения трафика конкурентов (Откуда они берут клиентов)
              </div>
              <p className="mt-0.5 text-[13px] text-[#6f7282]">
                Разбивка месячного трафика каждого сайта по источникам (SEO-органика, Яндекс.Директ, прямые/реферальные переходы) и главный вывод по их стратегии.
              </p>
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
              Обновить все домены
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {benchmark.domains.map((dom) => {
              const orgWidth = Math.max(0, Math.min(100, dom.organicSharePct ?? 0));
              const paidWidth = Math.max(
                0,
                Math.min(100 - orgWidth, dom.paidSharePct ?? 0),
              );
              const otherWidth = Math.max(0, 100 - orgWidth - paidWidth);
              const topClusters = clustersByDomain.get(dom.domain) ?? [];

              return (
                <div
                  key={dom.domain}
                  className={`flex flex-col justify-between rounded-2xl border p-4 ${
                    dom.isWesetup
                      ? "border-[#d8deff] bg-[#eef1ff]/45"
                      : "border-[#dcdfed] bg-[#fafbff]"
                  }`}
                >
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[16px] font-semibold text-[#0b1024]">
                          {dom.domain}
                        </span>
                        {dom.isWesetup ? (
                          <span className="rounded-full bg-[#5566f6] px-2.5 py-0.5 text-[11px] font-medium text-white">
                            Наш сайт
                          </span>
                        ) : (
                          <span className="rounded-full border border-[#dcdfed] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#0b1024]">
                            {dom.visitsRatioVsWesetup}× к нашему трафику
                          </span>
                        )}
                      </div>
                      <span className="text-[11.5px] text-[#6f7282]">
                        {dom.periodLabel}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <span className="text-[22px] font-semibold text-[#0b1024]">
                          {dom.visitsMonthly.toLocaleString("ru-RU")}
                        </span>{" "}
                        <span className="text-[12.5px] text-[#6f7282]">
                          визитов / мес
                        </span>
                      </div>
                      <span className="text-[12px] font-semibold text-[#3848c7]">
                        {dom.primaryChannelLabel}
                      </span>
                    </div>

                    {/* Visual stacked channel bar */}
                    <div className="mt-3">
                      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[#e4e7f5]">
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
                            title={`Платная реклама: ${paidWidth}%`}
                          />
                        ) : null}
                        {otherWidth > 0 ? (
                          <div
                            style={{ width: `${otherWidth}%` }}
                            className="bg-[#8b92b2]"
                            title={`Прямые / Реферальные / Брендовые: ${otherWidth}%`}
                          />
                        ) : null}
                      </div>

                      <div className="mt-2 grid grid-cols-3 gap-2 text-[11.5px]">
                        <div className="rounded-xl border border-[#dcdfed]/70 bg-white px-2.5 py-1.5">
                          <div className="flex items-center gap-1.5 text-[#6f7282]">
                            <span className="size-2 rounded-full bg-[#116b2a]" />
                            SEO Органика
                          </div>
                          <div className="mt-0.5 font-semibold text-[#0b1024]">
                            {dom.organicSharePct !== null
                              ? `${dom.organicSharePct}%`
                              : "—"}{" "}
                            <span className="font-normal text-[#6f7282]">
                              (~{dom.estimatedOrganicVisits.toLocaleString("ru-RU")})
                            </span>
                          </div>
                        </div>

                        <div className="rounded-xl border border-[#dcdfed]/70 bg-white px-2.5 py-1.5">
                          <div className="flex items-center gap-1.5 text-[#6f7282]">
                            <span className="size-2 rounded-full bg-[#d97706]" />
                            Реклама (Директ)
                          </div>
                          <div className="mt-0.5 font-semibold text-[#0b1024]">
                            {dom.paidSharePct !== null
                              ? `${dom.paidSharePct}%`
                              : "0%"}{" "}
                            <span className="font-normal text-[#6f7282]">
                              (~{dom.estimatedPaidVisits.toLocaleString("ru-RU")})
                            </span>
                          </div>
                        </div>

                        <div className="rounded-xl border border-[#dcdfed]/70 bg-white px-2.5 py-1.5">
                          <div className="flex items-center gap-1.5 text-[#6f7282]">
                            <span className="size-2 rounded-full bg-[#8b92b2]" />
                            Прямые / Прочие
                          </div>
                          <div className="mt-0.5 font-semibold text-[#0b1024]">
                            {dom.otherSharePct}%{" "}
                            <span className="font-normal text-[#6f7282]">
                              (~{dom.estimatedOtherVisits.toLocaleString("ru-RU")})
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Clear diagnostic takeaway */}
                    <div className="mt-3 rounded-xl border border-[#dcdfed]/80 bg-white p-3 text-[12.5px] leading-snug text-[#3c4053]">
                      <strong className="text-[#0b1024]">Вывод по каналу:</strong>{" "}
                      {dom.channelStrategySummary}
                    </div>
                  </div>

                  {/* Top 3 search queries of this domain */}
                  {topClusters.length > 0 ? (
                    <div className="mt-3 space-y-1 border-t border-[#dcdfed]/70 pt-2.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6f7282]">
                        Главные точки входа из поиска:
                      </div>
                      {topClusters.slice(0, 3).map((cl, i) => (
                        <div
                          key={`${cl.phrase}-${i}`}
                          className="flex items-center justify-between gap-2 text-[12px]"
                        >
                          <span className="truncate text-[#0b1024]">
                            • {cl.phrase}
                          </span>
                          <span className="shrink-0 text-[11px] font-medium text-[#3848c7]">
                            {cl.trafficSharePct}% →{" "}
                            {shortWesetupPath(cl.mappedTargetUrl)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* SECTION 2: ЧТО НАМ СДЕЛАТЬ ПО SEO (Конкретный план улучшений по результатам сверки) */}
      {benchmark && benchmark.actionPlan && benchmark.actionPlan.length > 0 ? (
        <section className={SEO_CARD_CLASS}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                <Sparkles className="size-4 text-[#5566f6]" />
                2. Рекомендации и план улучшений SEO для wesetup.ru
              </div>
              <p className="mt-0.5 text-[13px] text-[#6f7282]">
                Готовый список действий по приоритету: какие страницы дожать ссылками в ТОП-3, какие платные запросы конкурентов перехватить бесплатной органикой и какой контент расширить.
              </p>
            </div>

            {benchmark.summary.totalPotentialMonthlyVisits > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#bbf7d0] bg-[#ecfdf5] px-3.5 py-1 text-[12.5px] font-semibold text-[#116b2a]">
                <Rocket className="size-3.5" />
                Потенциал перехвата: +
                {benchmark.summary.totalPotentialMonthlyVisits.toLocaleString(
                  "ru-RU",
                )}{" "}
                целевых визитов/мес
              </span>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {benchmark.actionPlan.map((act, index) => (
              <div
                key={act.id}
                className="flex flex-col justify-between rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4"
              >
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${badgeToneClass(
                        act.priority === "high" ? "indigo" : "amber",
                      )}`}
                    >
                      Шаг {index + 1} · {act.badgeLabel}
                    </span>
                    <span className="text-[12px] font-semibold text-[#116b2a]">
                      ~{act.potentialVisitsMonthly.toLocaleString("ru-RU")} виз./мес у{" "}
                      {act.competitorDomain}
                    </span>
                  </div>

                  <div className="mt-2 text-[15px] font-semibold text-[#0b1024]">
                    {act.title}
                  </div>

                  <p className="mt-1 text-[12.5px] leading-snug text-[#3c4053]">
                    {act.whyText}
                  </p>

                  <div className="mt-3 space-y-1.5 rounded-xl border border-[#dcdfed]/80 bg-white p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6f7282]">
                      Что конкретно сделать:
                    </div>
                    {act.actionSteps.map((step, sIdx) => (
                      <div
                        key={sIdx}
                        className="flex items-start gap-2 text-[12.5px] text-[#0b1024]"
                      >
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[#5566f6]" />
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#dcdfed]/70 pt-3">
                  <div className="flex items-center gap-3 text-[12px] text-[#6f7282]">
                    <a
                      href={`https://wesetup.ru${act.targetUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-[#3848c7] hover:underline"
                    >
                      {act.targetUrl}
                      <ExternalLink className="size-3" />
                    </a>
                    <span>
                      Яндекс: <strong>{act.yandexPos ?? "—"}</strong> · Ссылок:{" "}
                      <strong>{act.purchasedLinksCount}</strong>
                    </span>
                  </div>

                  <Link href={act.ctaHref} className={SEO_BTN_SM_CLASS}>
                    {act.ctaLabel}
                    <ArrowRight className="size-3.5 text-[#5566f6]" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* SECTION 3: СВЕРКА ПО ЗАПРОСАМ (Понятная таблица сравнения) */}
      {benchmark && benchmark.clusterGaps.length > 0 ? (
        <section className={SEO_CARD_CLASS}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                <TrendingUp className="size-4 text-[#5566f6]" />
                3. Сверка по запросам: где конкуренты получают трафик и на каком месте мы
              </div>
              <p className="mt-0.5 text-[13px] text-[#6f7282]">
                Каждый запрос конкурента сопоставлен с нашей посадочной страницей и текущим местом в Яндексе и Google.
              </p>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  {
                    key: "all",
                    label: `Все запросы · ${benchmark.clusterGaps.length}`,
                  },
                  {
                    key: "push_top3",
                    label: `Быстрый дожим в ТОП-3 · ${benchmark.summary.pushTop3Count}`,
                  },
                  {
                    key: "gap_no_rank",
                    label: `Упущенные запросы · ${benchmark.summary.gapNoRankCount}`,
                  },
                  {
                    key: "leader",
                    label: `Мы уже в ТОП-3 · ${benchmark.summary.leaderCount}`,
                  },
                ] as Array<{ key: VerdictFilterKey; label: string }>
              ).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setVerdictFilter(f.key)}
                  className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                    verdictFilter === f.key
                      ? "border-[#5566f6] bg-[#5566f6] text-white"
                      : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {competitorDomains.length > 1 ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-[#6f7282]">Сайт конкурента:</span>
                <select
                  value={domainFilter}
                  onChange={(e) => setDomainFilter(e.target.value)}
                  className={`${SEO_INPUT_CLASS} !h-8 !w-44 !text-[12px]`}
                >
                  <option value="all">Все конкуренты</option>
                  {competitorDomains.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[#ececf4]">
            <table className="w-full min-w-[940px] text-[13px]">
              <thead>
                <tr className="bg-[#fafbff] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                  <th className="px-4 py-3">Поисковый запрос</th>
                  <th className="px-4 py-3">Трафик у конкурента</th>
                  <th className="px-4 py-3">Наша страница wesetup.ru</th>
                  <th className="px-4 py-3">Наше место (Я / G)</th>
                  <th className="px-4 py-3">Что делать</th>
                </tr>
              </thead>
              <tbody>
                {filteredGaps.map((gap, idx) => (
                  <tr
                    key={`${gap.competitorDomain}:${gap.phrase}:${idx}`}
                    className="border-t border-[#ececf4] align-top hover:bg-[#fafbff]/60"
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-[#0b1024]">
                        «{gap.phrase}»
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-[#6f7282]">
                        {gap.competitorChannel === "paid"
                          ? "Конкурент покупает в Директе"
                          : "Конкурент получает из SEO"}
                      </div>
                    </td>

                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[#0b1024]">
                        {gap.competitorDomain}
                      </div>
                      <div className="mt-0.5 text-[12px] text-[#3848c7]">
                        <strong>
                          ~{gap.estimatedMonthlyTraffic.toLocaleString("ru-RU")}{" "}
                          виз./мес
                        </strong>{" "}
                        ({gap.competitorTrafficSharePct}%)
                      </div>
                    </td>

                    <td className="px-4 py-2.5">
                      <a
                        href={`https://wesetup.ru${gap.mappedTargetUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-[#3848c7] underline-offset-2 hover:underline"
                      >
                        {gap.mappedTargetUrl}
                        <ExternalLink className="size-3" />
                      </a>
                      <div className="mt-0.5 text-[11.5px] text-[#6f7282]">
                        Куплено ссылок: <strong>{gap.purchasedLinksCount}</strong>
                      </div>
                    </td>

                    <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px]">
                      <span className="font-semibold text-[#0b1024]">
                        {gap.yandexPos ? `#${gap.yandexPos}` : "вне ТОП-50"}
                      </span>{" "}
                      <span className="text-[#9b9fb3]">/</span>{" "}
                      <span className="text-[#3c4053]">
                        {gap.googlePos ? `#${gap.googlePos}` : "—"}
                      </span>
                    </td>

                    <td className="max-w-[360px] px-4 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badgeToneClass(
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
                            className="inline-flex items-center gap-1 rounded-xl border border-[#d8deff] bg-[#eef1ff] px-2.5 py-1 text-[11.5px] font-semibold text-[#3848c7] transition-colors hover:bg-[#dfe5ff]"
                          >
                            Усилить ссылкой
                            <ArrowRight className="size-3" />
                          </Link>
                        ) : null}
                      </div>
                      <div className="mt-1 text-[12px] leading-snug text-[#3c4053]">
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

      {/* SECTION 4: Свернутая детальная матрица всех 25 посадочных (для глубокого просмотра по клику) */}
      <section className={SEO_CARD_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Полный рейтинг всех посадочных страниц wesetup.ru ({priorityMatrix.length})
            </div>
            <p className="mt-0.5 text-[13px] text-[#6f7282]">
              Детальная таблица скоринга для планировщика закупок ссылок.
            </p>
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
                  Скрыть таблицу
                </>
              ) : (
                <>
                  <ChevronDown className="size-3.5" />
                  Показать все страницы
                </>
              )}
            </button>
          </div>
        </div>

        {showDetailedMatrix ? (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-[#ececf4]">
            <table className="w-full min-w-[920px] text-[13px]">
              <thead>
                <tr className="bg-[#fafbff] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                  <th className="px-4 py-3">Посадочная wesetup.ru</th>
                  <th className="px-4 py-3">Кластер спроса</th>
                  <th className="px-4 py-3">Topvisor (Я / G)</th>
                  <th className="px-4 py-3">Куплено ссылок</th>
                  <th className="px-4 py-3">Приоритет и скоринг</th>
                </tr>
              </thead>
              <tbody>
                {priorityMatrix.slice(0, 25).map((row) => {
                  const tier = formatPriorityTier(row.priorityTier);
                  return (
                    <tr
                      key={row.targetUrl}
                      className="border-t border-[#ececf4] align-top hover:bg-[#fafbff]/60"
                    >
                      <td className="max-w-[260px] px-4 py-2.5">
                        <a
                          href={`https://wesetup.ru${row.targetUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-[#3848c7] underline-offset-2 hover:underline"
                        >
                          {row.targetUrl}
                          <ExternalLink className="size-3" />
                        </a>
                        <div className="mt-0.5 text-[11.5px] text-[#3c4053]">
                          {row.title}
                        </div>
                      </td>

                      <td className="px-4 py-2.5">
                        <div className="font-medium text-[#0b1024]">
                          «{row.primaryKeyword}»
                        </div>
                        {row.competitorDomain ? (
                          <div className="mt-0.5 text-[11.5px] text-[#6f7282]">
                            {row.competitorDomain} ·{" "}
                            {row.competitorTrafficSharePct}% (
                            {row.competitorChannel === "paid"
                              ? "реклама"
                              : "органика"}
                            )
                          </div>
                        ) : null}
                      </td>

                      <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px]">
                        <span className="font-semibold text-[#0b1024]">
                          {row.yandexPos ?? "—"}
                        </span>{" "}
                        <span className="text-[#9b9fb3]">/</span>{" "}
                        <span className="text-[#3c4053]">
                          {row.googlePos ?? "—"}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-[#0b1024]">
                        {row.existingLinksCount}
                      </td>

                      <td className="max-w-[320px] px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badgeToneClass(
                              tier.tone,
                            )}`}
                          >
                            {tier.label}
                          </span>
                          <span className="text-[11.5px] font-semibold text-[#0b1024]">
                            {Math.round(row.score)} балл.
                          </span>
                        </div>
                        <div className="mt-1 text-[11.5px] text-[#6f7282]">
                          {row.selectionReason}
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

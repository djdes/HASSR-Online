"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  ExternalLink,
  ImageUp,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Scale,
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

function formatSourceKind(kind: string): string {
  switch (kind) {
    case "screenshot_ocr":
      return "OCR скриншота";
    case "agent_import":
      return "Similarweb (api-anything)";
    default:
      return "Ручной ввод";
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

  const [apiDomainInput, setApiDomainInput] = useState("haccp-online.ru");
  const [syncingApiDomain, setSyncingApiDomain] = useState<string | null>(null);
  const [swSettingsOpen, setSwSettingsOpen] = useState(false);
  const [swCookieInput, setSwCookieInput] = useState("");
  const [swApiKeyInput, setSwApiKeyInput] = useState("");
  const [savingSwConn, setSavingSwConn] = useState(false);

  const [verdictFilter, setVerdictFilter] = useState<VerdictFilterKey>("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");

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
      toast.error("Укажите домен для загрузки через api-anything");
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
          data?.error ??
            "Не удалось загрузить срез Similarweb через api-anything",
        );
      }
      const syncedCount = data.snapshots?.length ?? 1;
      toast.success(
        syncedCount > 1
          ? `Через api-anything обновлено срезов Similarweb: ${syncedCount}`
          : `Срез ${data.snapshot?.domain} (${data.snapshot?.periodLabel}) загружен через api-anything`,
      );
      await notifyChange();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Ошибка синхронизации Similarweb",
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
          ? "Сессия Similarweb (api-anything) очищена"
          : "Сессия Similarweb (api-anything) сохранена",
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
        `Срез Similarweb (${data.snapshot.domain}, ${data.snapshot.periodLabel}) распознан и сохранён`,
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
        throw new Error(data?.error ?? "Не удалось сохранить срез Similarweb");
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
      {/* 1. Similarweb api-anything sync & snapshots card */}
      <section className={SEO_CARD_CLASS}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              <BarChart3 className="size-4 text-[#5566f6]" />
              Срезы трафика и спроса Similarweb (api-anything)
            </div>
            <p className="mt-0.5 text-[13px] text-[#6f7282]">
              Загружайте актуальную статистику конкурентов (haccp-online.ru, checkoffice.ru и любых других доменов) через api-anything, по скриншоту или вручную.
            </p>
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
              className={SEO_BTN_PRIMARY_CLASS}
            >
              {uploadingOcr ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImageUp className="size-4" />
              )}
              {uploadingOcr
                ? "Распознаём через ИИ-воркер…"
                : "Распознать скриншот Similarweb"}
            </button>

            <button
              type="button"
              onClick={() => setSwSettingsOpen((v) => !v)}
              className={SEO_BTN_OUTLINE_CLASS}
            >
              <KeyRound className="size-4 text-[#5566f6]" />
              {swConn?.configured
                ? `Сессия api-anything (${swConn.cookieCount} кук)`
                : "Сессия api-anything"}
            </button>

            <button
              type="button"
              onClick={() => setManualOpen((v) => !v)}
              className={SEO_BTN_OUTLINE_CLASS}
            >
              <Plus className="size-4" />
              Внести кластеры вручную
            </button>
          </div>
        </div>

        {/* api-anything live sync bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-[#0b1024]">
              api-anything (Similarweb):
            </span>
            <input
              type="text"
              value={apiDomainInput}
              onChange={(e) => setApiDomainInput(e.target.value)}
              placeholder="haccp-online.ru"
              className={`${SEO_INPUT_CLASS} !h-8 !w-48 !text-[12.5px]`}
            />
            <button
              type="button"
              disabled={syncingApiDomain !== null}
              onClick={() => void handleSyncViaApiAnything([apiDomainInput])}
              className={SEO_BTN_SM_CLASS}
            >
              {syncingApiDomain === apiDomainInput.trim().toLowerCase() ? (
                <Loader2 className="size-3.5 animate-spin text-[#5566f6]" />
              ) : (
                <RefreshCw className="size-3.5 text-[#5566f6]" />
              )}
              Загрузить домен
            </button>
            {(["wesetup.ru", "haccp-online.ru", "checkoffice.ru"] as const).map(
              (presetDomain) => (
                <button
                  key={presetDomain}
                  type="button"
                  disabled={syncingApiDomain !== null}
                  onClick={() => {
                    setApiDomainInput(presetDomain);
                    void handleSyncViaApiAnything([presetDomain]);
                  }}
                  className="inline-flex h-7 items-center rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[11.5px] font-medium text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50"
                >
                  {presetDomain}
                </button>
              ),
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={syncingApiDomain !== null}
              onClick={() =>
                void handleSyncViaApiAnything([
                  "wesetup.ru",
                  "haccp-online.ru",
                  "checkoffice.ru",
                ])
              }
              className={SEO_BTN_SM_CLASS}
            >
              {syncingApiDomain === "all" ? (
                <Loader2 className="size-3.5 animate-spin text-[#5566f6]" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Обновить все 3 домена
            </button>
          </div>
        </div>

        {swSettingsOpen ? (
          <form
            method="post"
            onSubmit={(e) => void handleSaveSwConnection(e, false)}
            className="mt-3 space-y-3 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-semibold text-[#0b1024]">
                  Настройка сессии Similarweb для api-anything (Tier 1)
                </div>
                <p className="mt-0.5 text-[12px] text-[#6f7282]">
                  Similarweb защищён CloudFront / AWS WAF. Вставьте заголовок{" "}
                  <code>Cookie</code> или JSON-массив кук из браузера (включая{" "}
                  <code>aws-waf-token</code>, <code>sw_Session</code> /{" "}
                  <code>.SGTOKEN</code>), либо официальный{" "}
                  <code>SIMILARWEB_API_KEY</code>. Куки шифруются AES-256-GCM.
                </p>
              </div>
              {swConn ? (
                <span
                  className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badgeToneClass(
                    swConn.configured ? "emerald" : "amber",
                  )}`}
                >
                  {swConn.configured
                    ? `Активно (${swConn.cookieCount} кук${swConn.hasApiKey ? " + API key" : ""})`
                    : "Куки не заданы"}
                </span>
              ) : null}
            </div>

            {swConn?.lastError ? (
              <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-[12px] text-[#92400e]">
                Последний ответ Similarweb: {swConn.lastError}
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="mb-1 block text-[11.5px] font-medium text-[#6f7282]">
                  Сессионные куки Similarweb (Cookie header или JSON массив из DevTools)
                </label>
                <textarea
                  rows={3}
                  value={swCookieInput}
                  onChange={(e) => setSwCookieInput(e.target.value)}
                  placeholder="aws-waf-token=...; sw_Session=...; .SGTOKEN=..."
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
                {swConn?.cookieNames && swConn.cookieNames.length > 0 ? (
                  <div className="mt-2 text-[11px] text-[#6f7282]">
                    Сохранены куки: {swConn.cookieNames.join(", ")}
                  </div>
                ) : null}
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
                  Очистить сессию
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
                {savingSwConn ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Сохранить сессию api-anything
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
              Ручной импорт среза и поисковых кластеров Similarweb
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
                  Кластеры спроса и целевые страницы wesetup.ru
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
                  Добавить кластер
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
                {savingManual ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Сохранить срез
              </button>
            </div>
          </form>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {snapshots.map((snap) => {
            const clusters = parseClusters(snap.clusters);
            const isOwn = snap.domain === "wesetup.ru";
            return (
              <div
                key={snap.id}
                className={`rounded-2xl border p-4 ${
                  isOwn
                    ? "border-[#d8deff] bg-[#eef1ff]/45"
                    : "border-[#dcdfed] bg-[#fafbff]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-semibold text-[#0b1024]">
                    {snap.domain}
                    {isOwn ? (
                      <span className="ml-2 rounded-full bg-[#5566f6] px-2 py-0.5 text-[10.5px] font-medium text-white">
                        Мы
                      </span>
                    ) : null}
                  </span>
                  <span className="rounded-full border border-[#dcdfed] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#6f7282]">
                    {snap.periodLabel}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[#3c4053]">
                  <span>
                    Визиты/мес:{" "}
                    <strong className="text-[#0b1024]">
                      {snap.visitsMonthly.toLocaleString("ru-RU")}
                    </strong>
                  </span>
                  {snap.organicSharePct !== null ? (
                    <span>Органика: {snap.organicSharePct}%</span>
                  ) : null}
                  {snap.paidSharePct !== null ? (
                    <span>Реклама: {snap.paidSharePct}%</span>
                  ) : null}
                </div>

                <div className="mt-1 text-[11.5px] text-[#6f7282]">
                  Источник: {formatSourceKind(snap.sourceKind)}
                  {snap.bouncePct !== null
                    ? ` · отказы ${snap.bouncePct}%`
                    : ""}
                  {snap.pagesPerVisit !== null
                    ? ` · стр./визит ${snap.pagesPerVisit}`
                    : ""}
                </div>

                {clusters.length > 0 ? (
                  <div className="mt-3 space-y-1 border-t border-[#dcdfed]/70 pt-2.5">
                    {clusters.slice(0, 5).map((cl, i) => (
                      <div
                        key={`${cl.phrase}-${i}`}
                        className="flex items-center justify-between gap-2 text-[12px]"
                      >
                        <span className="truncate text-[#0b1024]">
                          {cl.phrase}
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

      {/* 2. Side-by-side Competitor Benchmark Table (wesetup.ru vs competitors) */}
      {benchmark && benchmark.domains.length > 0 ? (
        <section className={SEO_CARD_CLASS}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                <Scale className="size-4 text-[#5566f6]" />
                Сводная сверка доменов: wesetup.ru против конкурентов
              </div>
              <p className="mt-0.5 text-[13px] text-[#6f7282]">
                Сравнение месячного трафика, доли органического и платного поиска, вовлечённости и числа поисковых кластеров, где конкуренты обходят wesetup.ru.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="rounded-full border border-[#d8deff] bg-[#eef1ff] px-3 py-1 font-medium text-[#3848c7]">
                Зона дожима (ТОП 4–30):{" "}
                <strong>{benchmark.summary.pushTop3Count}</strong>
              </span>
              <span className="rounded-full border border-[#fde68a] bg-[#fffbeb] px-3 py-1 font-medium text-[#92400e]">
                Упущенные кластеры:{" "}
                <strong>{benchmark.summary.gapNoRankCount}</strong>
              </span>
              <span className="rounded-full border border-[#bbf7d0] bg-[#ecfdf5] px-3 py-1 font-medium text-[#116b2a]">
                Мы в ТОП-3: <strong>{benchmark.summary.leaderCount}</strong>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[#ececf4]">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="bg-[#fafbff] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                  <th className="px-4 py-3">Домен</th>
                  <th className="px-4 py-3">Период</th>
                  <th className="px-4 py-3">Визиты / мес</th>
                  <th className="px-4 py-3">К wesetup.ru</th>
                  <th className="px-4 py-3">Органика</th>
                  <th className="px-4 py-3">Реклама</th>
                  <th className="px-4 py-3">Отказы / Глубина</th>
                  <th className="px-4 py-3">Кластеров / Точек роста</th>
                </tr>
              </thead>
              <tbody>
                {benchmark.domains.map((row) => (
                  <tr
                    key={row.domain}
                    className={`border-t border-[#ececf4] ${
                      row.isWesetup
                        ? "bg-[#eef1ff]/40 font-medium"
                        : "hover:bg-[#fafbff]/60"
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#0b1024]">
                          {row.domain}
                        </span>
                        {row.isWesetup ? (
                          <span className="rounded-full bg-[#5566f6] px-2 py-0.5 text-[10.5px] font-semibold text-white">
                            Наш сайт
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[#6f7282]">
                      {row.periodLabel}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-[#0b1024]">
                      {row.visitsMonthly.toLocaleString("ru-RU")}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.isWesetup ? (
                        <span className="text-[#6f7282]">1.0× (база)</span>
                      ) : (
                        <span className="inline-flex rounded-full border border-[#dcdfed] bg-white px-2.5 py-0.5 text-[11.5px] font-semibold text-[#0b1024]">
                          {row.visitsRatioVsWesetup}× больше
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.organicSharePct !== null
                        ? `${row.organicSharePct}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.paidSharePct !== null ? `${row.paidSharePct}%` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[#3c4053]">
                      {row.bouncePct !== null ? `${row.bouncePct}%` : "—"} /{" "}
                      {row.pagesPerVisit !== null
                        ? `${row.pagesPerVisit} стр.`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-[#0b1024]">
                        {row.clustersCount}
                      </span>
                      {!row.isWesetup && row.gapClustersCount > 0 ? (
                        <span className="ml-1.5 text-[12px] text-[#3848c7]">
                          ({row.gapClustersCount} точек роста для нас)
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* 3. Cluster Gap Analysis (Сверка поисковых кластеров конкурентов с нашими позициями и страницами) */}
      {benchmark && benchmark.clusterGaps.length > 0 ? (
        <section className={SEO_CARD_CLASS}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                <TrendingUp className="size-4 text-[#5566f6]" />
                Сверка по поисковым кластерам (Gap-анализ конкурентов)
              </div>
              <p className="mt-0.5 text-[13px] text-[#6f7282]">
                Показывает, какие запросы приносят трафик конкурентам, какая страница wesetup.ru отвечает за этот запрос, на каком месте мы в Topvisor и что нужно сделать (контент или ссылки).
              </p>
            </div>

            <Link
              href="/root/seo/links"
              className={SEO_BTN_SM_CLASS}
            >
              Перейти к закупке ссылок (GoGetLinks)
              <ArrowRight className="size-3.5 text-[#5566f6]" />
            </Link>
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  {
                    key: "all",
                    label: `Все кластеры · ${benchmark.clusterGaps.length}`,
                  },
                  {
                    key: "push_top3",
                    label: `Дожим в ТОП-3 · ${benchmark.summary.pushTop3Count}`,
                  },
                  {
                    key: "gap_no_rank",
                    label: `Упущенные кластеры · ${benchmark.summary.gapNoRankCount}`,
                  },
                  {
                    key: "need_links",
                    label: `Нужен дожим · ${benchmark.summary.needLinksCount}`,
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
                <span className="text-[12px] text-[#6f7282]">Конкурент:</span>
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
            <table className="w-full min-w-[980px] text-[13px]">
              <thead>
                <tr className="bg-[#fafbff] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                  <th className="px-4 py-3">Кластер спроса конкурента</th>
                  <th className="px-4 py-3">Конкурент и трафик кластера</th>
                  <th className="px-4 py-3">Наша посадочная wesetup.ru</th>
                  <th className="px-4 py-3">Наши позиции (Я / G)</th>
                  <th className="px-4 py-3">Ссылок</th>
                  <th className="px-4 py-3">Статус сверки и рекомендация</th>
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
                        Канал у конкурента:{" "}
                        {gap.competitorChannel === "paid"
                          ? "Платный поиск (Директ)"
                          : "Органика"}
                      </div>
                    </td>

                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[#0b1024]">
                        {gap.competitorDomain}
                      </div>
                      <div className="mt-0.5 text-[12px] text-[#3848c7]">
                        <strong>{gap.competitorTrafficSharePct}%</strong> (~
                        {gap.estimatedMonthlyTraffic.toLocaleString("ru-RU")}{" "}
                        виз./мес)
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
                      {gap.wesetupSharePct !== null ? (
                        <div className="mt-0.5 text-[11.5px] text-[#116b2a]">
                          Доля в нашем трафике: {gap.wesetupSharePct}%
                        </div>
                      ) : null}
                    </td>

                    <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px]">
                      <span className="font-semibold text-[#0b1024]">
                        {gap.yandexPos ?? "—"}
                      </span>{" "}
                      <span className="text-[#9b9fb3]">/</span>{" "}
                      <span className="text-[#3c4053]">
                        {gap.googlePos ?? "—"}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-[#0b1024]">
                      {gap.purchasedLinksCount}
                    </td>

                    <td className="max-w-[340px] px-4 py-2.5">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badgeToneClass(
                          formatVerdictTone(gap.verdict),
                        )}`}
                      >
                        {gap.verdictLabel}
                      </span>
                      <div className="mt-1 text-[11.5px] leading-snug text-[#6f7282]">
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

      {/* 4. Priority Matrix: Similarweb x Topvisor x Purchased Links */}
      <section className={SEO_CARD_CLASS}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Итоговый рейтинг посадочных wesetup.ru: Спрос Similarweb × Позиция Topvisor × Ссылки
            </div>
            <p className="mt-0.5 text-[13px] text-[#6f7282]">
              Ранжированный список наших страниц по потенциалу прироста органического трафика.
            </p>
          </div>
          <button
            type="button"
            disabled={loadingMatrix}
            onClick={() => void loadMatrix()}
            className={SEO_BTN_SM_CLASS}
          >
            <RefreshCw
              className={`size-3.5 ${loadingMatrix ? "animate-spin" : ""}`}
            />
            Пересчитать сверку
          </button>
        </div>

        {matrixData?.topvisor.error ? (
          <div className="mb-3 rounded-2xl border border-[#fde68a] bg-[#fffbeb] px-4 py-2.5 text-[12.5px] text-[#92400e]">
            Topvisor вернул предупреждение: {matrixData.topvisor.error}. Скоринг рассчитан по кластерам Similarweb и текущим ссылкам.
          </div>
        ) : null}

        {loadingMatrix && priorityMatrix.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[13.5px] text-[#6f7282]">
            <Loader2 className="size-4 animate-spin text-[#5566f6]" />
            Сводим кластеры Similarweb с живыми позициями Topvisor…
          </div>
        ) : priorityMatrix.length === 0 ? (
          <div className="py-10 text-center text-[13.5px] text-[#6f7282]">
            Нет данных для расчёта приоритетов.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#ececf4]">
            <table className="w-full min-w-[920px] text-[13px]">
              <thead>
                <tr className="bg-[#fafbff] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                  <th className="px-4 py-3">Посадочная wesetup.ru</th>
                  <th className="px-4 py-3">Кластер Similarweb</th>
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
        )}
      </section>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  ExternalLink,
  ImageUp,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { ScoredTargetPage } from "@/lib/seo/gogetlinks-planner";
import {
  badgeToneClass,
  formatAccountStatusBadge,
  formatRub,
  generateClientIdempotencyKey,
} from "@/lib/seo/gogetlinks-ui-format";
import {
  formatRuDateTime,
  type GglAccountDto,
  type GglCampaignDto,
  SEO_BTN_OUTLINE_CLASS,
  SEO_BTN_PRIMARY_CLASS,
  SEO_BTN_SM_CLASS,
  SEO_CARD_CLASS,
  SEO_INPUT_CLASS,
  type SeoLinksViewerCapabilities,
  shortWesetupPath,
  type SimilarwebClusterDto,
  type SimilarwebMatrixResponse,
  type SimilarwebSnapshotDto,
} from "./types";

export interface DemandAndAccountTabProps {
  account: GglAccountDto | null;
  campaigns: GglCampaignDto[];
  snapshots: SimilarwebSnapshotDto[];
  viewer: SeoLinksViewerCapabilities;
  onRefreshOverview: () => Promise<void> | void;
}

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

function formatSourceKind(kind: string): string {
  switch (kind) {
    case "screenshot_ocr":
      return "OCR скриншота";
    case "agent_import":
      return "Аудит Similarweb";
    default:
      return "Ручной ввод";
  }
}

export function DemandAndAccountTab({
  account,
  campaigns,
  snapshots: initialSnapshots,
  viewer,
  onRefreshOverview,
}: DemandAndAccountTabProps) {
  const [matrixData, setMatrixData] = useState<SimilarwebMatrixResponse | null>(
    null,
  );
  const [loadingMatrix, setLoadingMatrix] = useState(false);

  const [uploadingOcr, setUploadingOcr] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      mappedTargetUrl: "/zhurnal-brakerazha-gotovoy-produkcii",
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
          data?.error ?? "Не удалось рассчитать матрицу приоритетов посадочных",
        );
      }
      setMatrixData(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка загрузки матрицы");
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
      await Promise.all([loadMatrix(), onRefreshOverview()]);
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
      await Promise.all([loadMatrix(), onRefreshOverview()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка импорта среза");
    } finally {
      setSavingManual(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. GoGetLinks Account & Wesetup Campaign Connection Card */}
      <AccountConnectionCard
        key={`${account?.id ?? "none"}:${account?.lastSyncedAt ?? ""}:${account?.defaultCampaignId ?? ""}:${account?.allowSeoApproveWithinPlan ?? false}`}
        account={account}
        campaigns={campaigns}
        viewer={viewer}
        onRefreshOverview={onRefreshOverview}
      />

      {/* 2. Similarweb Competitor Snapshots */}
      <section className={SEO_CARD_CLASS}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              <BarChart3 className="size-4 text-[#5566f6]" />
              Срезы конкурентного спроса Similarweb
            </div>
            <p className="mt-0.5 text-[13px] text-[#6f7282]">
              Трафик и поисковые кластеры конкурентов (haccp-online.ru, checkoffice.ru и др.) определяют, каким посадочным wesetup.ru нужен ссылочный вес в первую очередь.
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
              onClick={() => setManualOpen((v) => !v)}
              className={SEO_BTN_OUTLINE_CLASS}
            >
              <Plus className="size-4" />
              Внести кластеры вручную
            </button>
          </div>
        </div>

        {manualOpen ? (
          <form
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
                  type="number" inputMode="decimal"
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
                  type="number" inputMode="decimal"
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
                  type="number" inputMode="decimal"
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
                <div
                  key={idx}
                  className="grid gap-2 sm:grid-cols-12"
                >
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
                    type="number" inputMode="decimal"
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
                    placeholder="/zhurnal-..."
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
                    {clusters.slice(0, 4).map((cl, i) => (
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

      {/* 3. Priority Matrix: Similarweb x Topvisor x Purchased Links */}
      <section className={SEO_CARD_CLASS}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Матрица приоритетов: Кластер Similarweb × Позиция Topvisor × Куплено ссылок
            </div>
            <p className="mt-0.5 text-[13px] text-[#6f7282]">
              Именно в этом порядке планировщик распределяет новые слоты закупок на посадочные и статьи wesetup.ru.
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
            Пересчитать приоритеты
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

function AccountConnectionCard({
  account,
  campaigns,
  viewer,
  onRefreshOverview,
}: {
  account: GglAccountDto | null;
  campaigns: GglCampaignDto[];
  viewer: SeoLinksViewerCapabilities;
  onRefreshOverview: () => Promise<void> | void;
}) {
  const wesetupCampaigns = campaigns.filter((c) => c.isWesetup);
  const statusBadge = formatAccountStatusBadge(account?.status);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [defaultCampaignId, setDefaultCampaignId] = useState<string>(() => {
    if (account?.defaultCampaignId) return String(account.defaultCampaignId);
    const activeWs = wesetupCampaigns.find((c) => c.state === "active") ?? wesetupCampaigns[0];
    return activeWs ? String(activeWs.gglCampaignId) : "";
  });
  const [allowSeoApproveWithinPlan, setAllowSeoApproveWithinPlan] = useState(
    account?.allowSeoApproveWithinPlan ?? false,
  );
  const [savingAccount, setSavingAccount] = useState(false);
  const [ensuringCampaign, setEnsuringCampaign] = useState(false);

  async function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!viewer.isSuperadmin) return;
    if (!account && (!email.trim() || !password)) {
      toast.error("Для первого подключения укажите email и пароль GoGetLinks");
      return;
    }

    setSavingAccount(true);
    try {
      const payload: Record<string, unknown> = {
        allowSeoApproveWithinPlan,
        defaultCampaignId: defaultCampaignId
          ? Number.parseInt(defaultCampaignId, 10)
          : null,
      };
      if (email.trim()) payload.email = email.trim();
      if (password) payload.password = password;

      const response = await fetch("/api/root/gogetlinks/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          data?.error ?? "Не удалось сохранить подключение GoGetLinks",
        );
      }
      setEmail("");
      setPassword("");
      toast.success("Настройки кабинета GoGetLinks сохранены и проверены");
      await onRefreshOverview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSavingAccount(false);
    }
  }

  async function handleEnsureCampaign() {
    if (!viewer.isSuperadmin) return;
    setEnsuringCampaign(true);
    try {
      const response = await fetch("/api/root/gogetlinks/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "WeSetup электронные журналы ХАССП",
          idempotencyKey: generateClientIdempotencyKey("ensure-wesetup-camp"),
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        campaign?: { name: string; gglCampaignId: number };
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          data?.error ??
            "Не удалось создать или привязать кампанию wesetup.ru в GoGetLinks",
        );
      }
      toast.success(
        data?.campaign
          ? `Кампания ${data.campaign.name} (#${data.campaign.gglCampaignId}) активна и привязана`
          : "Кампания wesetup.ru готова к работе",
      );
      await onRefreshOverview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка кампании");
    } finally {
      setEnsuringCampaign(false);
    }
  }

  return (
    <section className={SEO_CARD_CLASS}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            <KeyRound className="size-4 text-[#5566f6]" />
            Подключение кабинета GoGetLinks (api-anything Tier 1)
          </div>
          <p className="mt-0.5 text-[13px] text-[#6f7282]">
            Учётные данные и сессионные куки шифруются AES-256-GCM на сервере. Все автоматические и ручные операции изолированы доменом wesetup.ru.
          </p>
        </div>

        <span
          className={`inline-flex rounded-full border px-3 py-1 text-[12px] font-medium ${badgeToneClass(
            statusBadge.badgeTone,
          )}`}
        >
          {statusBadge.label}
        </span>
      </div>

      {/* Read-only status summary visible to both superadmin and seo */}
      <div className="mt-4 grid gap-3 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-[11.5px] text-[#6f7282]">Аккаунт GoGetLinks</div>
          <div className="mt-0.5 text-[14px] font-semibold text-[#0b1024]">
            {account?.email ?? "Не настроен"}
          </div>
        </div>
        <div>
          <div className="text-[11.5px] text-[#6f7282]">Кошелёк кабинета</div>
          <div className="mt-0.5 text-[14px] font-semibold text-[#0b1024]">
            {formatRub(account?.availableRub ?? 0)}{" "}
            <span className="text-[12px] font-normal text-[#6f7282]">
              доступно из {formatRub(account?.balanceRub ?? 0)}
            </span>
          </div>
        </div>
        <div>
          <div className="text-[11.5px] text-[#6f7282]">
            Активные кампании wesetup.ru
          </div>
          <div className="mt-0.5 text-[14px] font-semibold text-[#0b1024]">
            {wesetupCampaigns.length > 0
              ? wesetupCampaigns
                  .map((c) => `${c.name} (#${c.gglCampaignId})`)
                  .join(", ")
              : "Ещё не создана"}
          </div>
          {account?.defaultCampaignId && wesetupCampaigns.some((c) => c.gglCampaignId === account.defaultCampaignId) ? (
            <div className="mt-1 inline-flex items-center rounded-full border border-[#bce3c8] bg-[#e9f8ee] px-2 py-0.5 text-[11px] font-medium text-[#116b2a]">
              Выбрана перманентно (#{account.defaultCampaignId})
            </div>
          ) : null}
        </div>
        <div>
          <div className="text-[11.5px] text-[#6f7282]">
            Последняя синхронизация
          </div>
          <div className="mt-0.5 text-[14px] font-semibold text-[#0b1024]">
            {formatRuDateTime(account?.lastSyncedAt)}
          </div>
        </div>
      </div>

      {viewer.isSuperadmin ? (
        <form
          onSubmit={(e) => void handleSaveAccount(e)}
          className="mt-4 space-y-4 border-t border-[#ececf4] pt-4"
        >
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
                {account
                  ? "Новый email GoGetLinks (оставьте пустым, чтобы не менять)"
                  : "Email аккаунта GoGetLinks"}
              </label>
              <input
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={account?.email ?? "seo@wesetup.ru"}
                className={SEO_INPUT_CLASS}
              />
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
                {account
                  ? "Новый пароль (оставьте пустым, чтобы не менять)"
                  : "Пароль GoGetLinks"}
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className={SEO_INPUT_CLASS}
              />
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
                Основная кампания wesetup.ru
              </label>
              <select
                value={defaultCampaignId}
                onChange={(e) => setDefaultCampaignId(e.target.value)}
                className={SEO_INPUT_CLASS}
              >
                <option value="">Выбирать автоматически (wesetup.ru)</option>
                {wesetupCampaigns.map((c) => (
                  <option key={c.id} value={String(c.gglCampaignId)}>
                    {c.name} (#{c.gglCampaignId})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2.5 text-[13px] text-[#0b1024]">
              <input
                type="checkbox"
                checked={allowSeoApproveWithinPlan}
                onChange={(e) =>
                  setAllowSeoApproveWithinPlan(e.target.checked)
                }
                className="size-4 rounded border-[#dcdfed] text-[#5566f6]"
              />
              <span>
                Разрешить специалистам с разделом <strong>«SEO и реклама»</strong> самостоятельно подтверждать подготовленные слоты в пределах утверждённого плана
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              {account ? (
                <button
                  type="button"
                  disabled={ensuringCampaign}
                  onClick={() => void handleEnsureCampaign()}
                  className={SEO_BTN_OUTLINE_CLASS}
                >
                  {ensuringCampaign ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Rocket className="size-4 text-[#5566f6]" />
                  )}
                  {wesetupCampaigns.some((c) => c.state === "active")
                    ? "Закрепить кампанию wesetup.ru в GoGetLinks"
                    : "Создать кампанию wesetup.ru в GoGetLinks"}
                </button>
              ) : null}

              <button
                type="submit"
                disabled={savingAccount}
                className={SEO_BTN_PRIMARY_CLASS}
              >
                {savingAccount ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {savingAccount ? "Проверка входа…" : "Сохранить настройки"}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="mt-3 text-[12.5px] text-[#6f7282]">
          Право подтверждения слотов внутри плана для роли SEO:{" "}
          <strong className="text-[#0b1024]">
            {account?.allowSeoApproveWithinPlan
              ? "включено владельцем"
              : "выключено (подтверждает администратор платформы)"}
          </strong>
          . Изменение логина, пароля и создание кампании доступны только владельцу (`superadmin`).
        </div>
      )}
    </section>
  );
}

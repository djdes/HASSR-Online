"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Play, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DEFAULT_REGION_INDEXES,
  TOPVISOR_REGIONS,
  regionLabel,
} from "@/lib/topvisor-regions";
// Только типы — они стираются при компиляции и в бандл не попадают.
import type {
  PositionMatrix,
  PositionSummary,
  TopvisorCheckStatus,
} from "@/lib/topvisor";

type ArticleInfo = { title: string; published: boolean };

type Props = {
  configured: boolean;
  articleBySlug: Record<string, ArticleInfo>;
};

const WINDOWS = [
  { days: 7, label: "7 дней" },
  { days: 30, label: "30 дней" },
  { days: 90, label: "90 дней" },
];

const DEFAULT_REGIONS = DEFAULT_REGION_INDEXES;

/** Позиция → как красить ячейку. Три полосы вместо градиента: читаемее. */
function cellTone(position: number | null): string {
  if (position == null) return "text-[#9b9fb3]";
  if (position <= 3) return "bg-[#ecfdf5] text-[#116b2a] font-semibold";
  if (position <= 10) return "bg-[#eef1ff] text-[#3848c7] font-medium";
  if (position <= 50) return "bg-[#fafbff] text-[#3c4053]";
  return "text-[#9b9fb3]";
}

function formatDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}.${month}`;
}

/** Достаёт slug статьи, если поисковик ответил страницей блога. */
function blogSlug(url: string | null): string | null {
  if (!url) return null;
  try {
    const path = new URL(url).pathname.replace(/\/$/, "");
    const match = path.match(/^\/blog\/(.+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function shortPath(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

type CheckScope = "yandex" | "google" | "all";

const CHECK_SCOPE_REGIONS: Record<CheckScope, number[]> = {
  yandex: TOPVISOR_REGIONS.filter((r) => r.searcher === "Яндекс").map(
    (r) => r.index
  ),
  google: TOPVISOR_REGIONS.filter((r) => r.searcher === "Google").map(
    (r) => r.index
  ),
  all: TOPVISOR_REGIONS.map((r) => r.index),
};

export function PositionsClient({ configured, articleBySlug }: Props) {
  // Тип задан явно: DEFAULT_REGIONS выведен из `as const` и сузился бы
  // до литералов 1 | 5, а в селекторе доступны все четыре региона.
  const [regionIndex, setRegionIndex] = useState<number>(DEFAULT_REGIONS[0] ?? 1);
  const [days, setDays] = useState(30);
  const [matrix, setMatrix] = useState<PositionMatrix | null>(null);
  const [summary, setSummary] = useState<PositionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");

  const [checkOpen, setCheckOpen] = useState(false);
  const [checkScope, setCheckScope] = useState<CheckScope>("yandex");
  const [price, setPrice] = useState<number | null>(null);
  const [pricing, setPricing] = useState(false);
  const [activeCheck, setActiveCheck] = useState<TopvisorCheckStatus | null>(null);
  const wasCheckingRef = useRef(false);

  const checking = Boolean(activeCheck?.checking);
  const checkRegions = CHECK_SCOPE_REGIONS[checkScope];

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setLoading(true);
      try {
        const response = await fetch(
          `/api/root/topvisor/positions?region=${regionIndex}&days=${days}`,
          { cache: "no-store" }
        );
        const data = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(data?.error ?? "Не удалось загрузить позиции");
        setMatrix(data.matrix ?? null);
        setSummary(data.summary ?? null);
        const nextCheck: TopvisorCheckStatus | null = data.activeCheck ?? null;
        setActiveCheck(nextCheck);
        if (wasCheckingRef.current && !nextCheck) {
          wasCheckingRef.current = false;
          toast.success("Съём позиций завершён, матрица обновлена");
        } else if (nextCheck?.checking) {
          wasCheckingRef.current = true;
        }
      } catch (error) {
        if (!options?.silent) {
          toast.error(error instanceof Error ? error.message : "Ошибка загрузки");
          setMatrix(null);
          setSummary(null);
        }
      } finally {
        if (!options?.silent) setLoading(false);
        setLoaded(true);
      }
    },
    [regionIndex, days]
  );

  useEffect(() => {
    if (configured) void load();
  }, [configured, load]);

  useEffect(() => {
    if (!configured || !checking) return;
    const timer = window.setInterval(() => {
      void load({ silent: true });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [configured, checking, load]);

  const fetchScopePrice = useCallback(async (scope: CheckScope) => {
    const regions = CHECK_SCOPE_REGIONS[scope];
    setPricing(true);
    try {
      const response = await fetch(
        `/api/root/topvisor/checker?regions=${regions.join(",")}`,
        { cache: "no-store" }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Не удалось узнать цену");
      if (data?.activeCheck?.checking) {
        setActiveCheck(data.activeCheck);
        wasCheckingRef.current = true;
        setCheckOpen(false);
        toast.info("Съём позиций уже выполняется");
        return false;
      }
      setPrice(typeof data.price === "number" ? data.price : null);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
      return false;
    } finally {
      setPricing(false);
    }
  }, []);

  /** Цену спрашиваем до открытия диалога: сумма должна быть в тексте. */
  async function askCheck() {
    if (checking) return;
    const selectedRegion = TOPVISOR_REGIONS.find((r) => r.index === regionIndex);
    const defaultScope: CheckScope =
      selectedRegion?.searcher === "Google" ? "google" : "yandex";
    setCheckScope(defaultScope);
    const ok = await fetchScopePrice(defaultScope);
    if (ok) {
      setCheckOpen(true);
    }
  }

  async function handleChangeScope(nextScope: CheckScope) {
    setCheckScope(nextScope);
    await fetchScopePrice(nextScope);
  }

  async function runCheck() {
    if (checking) {
      setCheckOpen(false);
      return;
    }
    const response = await fetch("/api/root/topvisor/checker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regions: checkRegions }),
    });
    const data = await response.json().catch(() => null);
    if (response.status === 409 && data?.activeCheck) {
      setActiveCheck(data.activeCheck);
      wasCheckingRef.current = true;
      setCheckOpen(false);
      toast.info(data?.error ?? "Съём позиций уже выполняется");
      return;
    }
    if (!response.ok || !data?.queued) {
      toast.error(data?.error ?? "Съём не запустился");
      return;
    }
    const nextCheck: TopvisorCheckStatus = data.activeCheck ?? {
      checking: true,
      startedAt: new Date().toISOString(),
      price: typeof data.price === "number" ? data.price : price,
      percent: null,
      baselineDates: matrix?.dates ?? [],
    };
    setActiveCheck(nextCheck);
    wasCheckingRef.current = true;
    setCheckOpen(false);
    toast.success(
      `Съём запущен, спишется ${data.price} ₽. Результат появится через несколько минут.`
    );
  }

  const rows = useMemo(() => {
    if (!matrix) return [];
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? matrix.rows.filter((row) => row.phrase.toLowerCase().includes(needle))
      : matrix.rows;
    // Фразы с позициями наверх, дальше по позиции: пустые строки внизу
    // не мешают читать то, ради чего экран открыли.
    return [...filtered].sort((a, b) => {
      if (a.latest == null && b.latest == null)
        return a.phrase.localeCompare(b.phrase, "ru");
      if (a.latest == null) return 1;
      if (b.latest == null) return -1;
      return a.latest - b.latest;
    });
  }, [matrix, query]);

  if (!configured) {
    return (
      <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
        <div className="text-[15px] font-medium text-[#0b1024]">
          Topvisor не подключён
        </div>
        <p className="mx-auto mt-1.5 max-w-[460px] text-[13px] leading-relaxed text-[#6f7282]">
          Задайте на сервере переменные <code>TOPVISOR_API_KEY</code>,{" "}
          <code>TOPVISOR_USER_ID</code> и <code>TOPVISOR_PROJECT_ID</code> — после
          перезапуска матрица появится здесь.
        </p>
      </div>
    );
  }

  const noData = loaded && (!matrix || matrix.dates.length === 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={regionIndex}
          onChange={(event) => setRegionIndex(Number(event.target.value))}
          className="h-10 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13.5px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        >
          {TOPVISOR_REGIONS.map((region) => (
            <option key={region.index} value={region.index}>
              {region.searcher} · {region.region}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 rounded-2xl border border-[#dcdfed] bg-white p-1">
          {WINDOWS.map((window) => (
            <button
              key={window.days}
              type="button"
              onClick={() => setDays(window.days)}
              className={`rounded-xl px-3 py-1.5 text-[13px] transition-colors ${
                days === window.days
                  ? "bg-[#eef1ff] font-medium text-[#3848c7]"
                  : "text-[#6f7282] hover:bg-[#f5f6ff]"
              }`}
            >
              {window.label}
            </button>
          ))}
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по фразе"
          className="h-10 w-[220px] rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin text-[#5566f6]" />
            ) : (
              <RefreshCw className="size-4 text-[#5566f6]" />
            )}
            Обновить
          </button>
          <button
            type="button"
            onClick={() => void askCheck()}
            disabled={pricing || checking}
            className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[13.5px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pricing || checking ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            {checking
              ? activeCheck?.percent != null
                ? `Идёт съём (${activeCheck.percent}%)…`
                : "Идёт съём позиций…"
              : "Снять позиции"}
          </button>
        </div>
      </div>

      {checking && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#d8defd] bg-[#f5f6ff] px-4 py-3 text-[13.5px] text-[#0b1024]"
        >
          <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" />
          <div className="min-w-0 flex-1">
            <span className="font-medium text-[#3848c7]">
              Идёт съём позиций в Topvisor
              {activeCheck?.percent != null ? ` · ${activeCheck.percent}%` : ""}
            </span>
            <span className="ml-2 text-[#6f7282]">
              Обычно занимает 1–3 минуты. Таблица обновится автоматически, можно
              переключать вкладки или перезагружать страницу.
            </span>
          </div>
        </div>
      )}

      {summary && (
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="ok">ТОП-3 · {summary.top3}</Pill>
          <Pill tone="accent">ТОП-10 · {summary.top10}</Pill>
          <Pill>ТОП-50 · {summary.top50}</Pill>
          <Pill tone="muted">Вне · {summary.outside}</Pill>
          <Pill tone="muted">Всего фраз · {summary.tracked}</Pill>
        </div>
      )}

      {noData ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          {checking ? (
            <>
              <Loader2 className="mx-auto mb-3 size-6 animate-spin text-[#5566f6]" />
              <div className="text-[15px] font-medium text-[#0b1024]">
                Съём позиций выполняется…
              </div>
              <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-relaxed text-[#6f7282]">
                Запрос отправлен в Topvisor. Как только поисковики отдадут
                результаты, таблица появится здесь автоматически.
              </p>
            </>
          ) : (
            <>
              <div className="text-[15px] font-medium text-[#0b1024]">
                Съёмов ещё не было
              </div>
              <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-relaxed text-[#6f7282]">
                Фразы в Topvisor есть, но позиции по ним ни разу не снимали. Нажмите
                «Снять позиции» — сумма к списанию покажется до подтверждения.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[13.5px]">
              <thead>
                <tr className="border-b border-[#ececf4] text-[11px] uppercase tracking-[0.14em] text-[#9b9fb3]">
                  <th className="sticky left-0 z-10 bg-white px-5 py-3 text-left font-semibold">
                    Фраза
                  </th>
                  {matrix?.dates.map((date) => (
                    <th
                      key={date}
                      className="px-3 py-3 text-center font-semibold tabular-nums"
                    >
                      {formatDate(date)}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center font-semibold">Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const slug = blogSlug(row.latestUrl);
                  const article = slug ? articleBySlug[slug] : undefined;
                  return (
                    <tr
                      key={row.phrase}
                      className="border-b border-[#f2f3f8] last:border-0 hover:bg-[#fafbff]"
                    >
                      <td className="sticky left-0 z-10 max-w-[340px] bg-white px-5 py-3 align-top">
                        <div className="truncate text-[#0b1024]">{row.phrase}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[12px]">
                          {article ? (
                            <>
                              <FileText className="size-3.5 shrink-0 text-[#5566f6]" />
                              <span className="truncate text-[#3848c7]">
                                {article.title}
                              </span>
                            </>
                          ) : row.latestUrl ? (
                            <span className="truncate text-[#6f7282]">
                              {shortPath(row.latestUrl)}
                            </span>
                          ) : (
                            <span className="text-[#9b9fb3]">нет данных</span>
                          )}
                        </div>
                      </td>
                      {matrix?.dates.map((date) => {
                        const cell = row.byDate[date];
                        const position = cell?.position ?? null;
                        return (
                          <td key={date} className="px-2 py-3 text-center">
                            <span
                              className={`inline-flex min-w-[38px] justify-center rounded-lg px-2 py-1 tabular-nums ${cellTone(position)}`}
                            >
                              {position ?? "—"}
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-center tabular-nums">
                        <Delta value={row.delta} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={checkOpen}
        onClose={() => setCheckOpen(false)}
        onConfirm={runCheck}
        confirmDisabled={checking || pricing}
        variant="warn"
        title="Снять позиции сейчас?"
        description={
          pricing
            ? "Пересчитываем стоимость съёма…"
            : price != null
              ? `Спишется ${price} ₽ с баланса Topvisor.`
              : "Цену узнать не удалось — проверьте баланс в панели Topvisor."
        }
        bullets={[
          {
            label: `Регионы: ${checkRegions.map(regionLabel).join(", ")}`,
            tone: "info",
          },
          { label: "Деньги списываются сразу при запуске", tone: "warn" },
          { label: "Результат появится в матрице через несколько минут" },
        ]}
        confirmLabel="Снять"
      >
        <div className="space-y-1.5">
          <div className="text-[12px] font-medium text-[#6f7282]">
            Поисковая система для съёма
          </div>
          <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-1">
            {(
              [
                { id: "yandex", label: "Яндекс" },
                { id: "google", label: "Google" },
                { id: "all", label: "Яндекс + Google" },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={pricing}
                onClick={() => void handleChangeScope(option.id)}
                className={`rounded-xl px-2.5 py-2 text-[12.5px] font-medium transition-colors ${
                  checkScope === option.id
                    ? "bg-[#5566f6] text-white shadow-sm"
                    : "text-[#3c4053] hover:bg-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}

function Pill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "ok" | "accent" | "muted";
}) {
  const styles = {
    default: "bg-[#f5f6ff] text-[#3848c7]",
    ok: "bg-[#ecfdf5] text-[#116b2a]",
    accent: "bg-[#eef1ff] text-[#3848c7]",
    muted: "bg-[#f5f6f8] text-[#6f7282]",
  }[tone];
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[12px] tabular-nums ${styles}`}
    >
      {children}
    </span>
  );
}

/** Δ: рост позиции — это уменьшение числа, поэтому знак уже перевёрнут. */
function Delta({ value }: { value: number | null }) {
  if (value == null || value === 0)
    return <span className="text-[#9b9fb3]">—</span>;
  if (value > 0)
    return <span className="text-[#116b2a]">↑{value}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[#a13a32]">
      <TriangleAlert className="size-3.5" />
      {value}
    </span>
  );
}

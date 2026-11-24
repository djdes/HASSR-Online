"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Download, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

// Только типы — они стираются при компиляции и в бандл не попадают.
import type { Behavior, SearchQueriesReport } from "@/lib/seo/search-queries.server";

type View = "google" | "pages" | "yandex" | "notes";

const VIEWS: { id: View; label: string }[] = [
  { id: "google", label: "Google — запросы" },
  { id: "pages", label: "Google — страницы" },
  { id: "yandex", label: "Яндекс — фразы" },
  { id: "notes", label: "Пояснения" },
];

const WINDOWS = [
  { days: 30, label: "30 дней" },
  { days: 90, label: "90 дней" },
  { days: 180, label: "180 дней" },
];

const PAGE_SIZE = 200;

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function periodFor(days: number) {
  const to = new Date(Date.now() - 86_400_000);
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: iso(from), to: iso(to) };
}

function ruDate(s: string | null) {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}

const nf = new Intl.NumberFormat("ru-RU");
const int = (n: number | null | undefined) => (n == null ? "—" : nf.format(Math.round(n)));
const pct = (n: number | null | undefined) => (n == null ? "—" : `${(n * 100).toFixed(2).replace(".", ",")}%`);
const dec = (n: number | null | undefined, digits = 1) => (n == null ? "—" : n.toFixed(digits).replace(".", ","));
function mmss(sec: number | null | undefined) {
  if (sec == null) return "—";
  const s = Math.round(sec);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Колонка таблицы: заголовок, значение для сортировки и отображение. */
type Column<T> = {
  key: string;
  label: string;
  value: (row: T) => number | string | null;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
};

function behaviorColumns<T>(get: (row: T) => Behavior | null, goalId: number | null, visitsLabel = "Визиты"): Column<T>[] {
  const reaches = (b: Behavior | null) => (b ? (goalId == null ? b.reaches : (b.goals[goalId]?.reaches ?? 0)) : null);
  const conv = (b: Behavior | null) => (b ? (goalId == null ? b.conversion : (b.goals[goalId]?.conversion ?? 0)) : null);
  const cols: Omit<Column<T>, "align">[] = [
    { key: "visits", label: visitsLabel, value: (r) => get(r)?.visits ?? null, render: (r) => int(get(r)?.visits) },
    { key: "users", label: "Посетители", value: (r) => get(r)?.users ?? null, render: (r) => int(get(r)?.users) },
    { key: "bounce", label: "Отказы", value: (r) => get(r)?.bounceRate ?? null, render: (r) => pct(get(r)?.bounceRate) },
    { key: "depth", label: "Глубина", value: (r) => get(r)?.pageDepth ?? null, render: (r) => dec(get(r)?.pageDepth, 2) },
    { key: "time", label: "Время", value: (r) => get(r)?.duration ?? null, render: (r) => mmss(get(r)?.duration) },
    { key: "reaches", label: "Цели", value: (r) => reaches(get(r)), render: (r) => int(reaches(get(r))) },
    { key: "conv", label: "Конверсия", value: (r) => conv(get(r)), render: (r) => pct(conv(get(r))) },
  ];
  return cols.map((c) => ({ ...c, align: "right" as const }));
}

type GscLike = { clicks: number; impressions: number; ctr: number; position: number | null };

function gscColumns<T extends GscLike>(): Column<T>[] {
  return [
    { key: "clicks", label: "Клики", value: (r) => r.clicks, render: (r) => int(r.clicks), align: "right" },
    { key: "impr", label: "Показы", value: (r) => r.impressions, render: (r) => int(r.impressions), align: "right" },
    { key: "ctr", label: "CTR", value: (r) => r.ctr, render: (r) => pct(r.ctr), align: "right" },
    { key: "pos", label: "Позиция", value: (r) => r.position, render: (r) => dec(r.position), align: "right" },
  ];
}

function pagePath(page: string) {
  const i = page.indexOf("/");
  return i < 0 ? page : page.slice(i);
}

function PageLink({ page }: { page: string }) {
  return (
    <a
      href={`https://${page}`}
      target="_blank"
      rel="noreferrer"
      className="text-[#3848c7] underline-offset-2 hover:underline"
      title={page}
    >
      {pagePath(page)}
    </a>
  );
}

function SortableTable<T>({
  columns,
  rows,
  totals,
  initialSort,
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  totals: Record<string, ReactNode>;
  initialSort: string;
  rowKey: (row: T, i: number) => string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: initialSort, dir: -1 });
  const [limit, setLimit] = useState(PAGE_SIZE);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    return [...rows].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // пустые — всегда внизу
      if (vb == null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(String(vb), "ru") : va - (vb as number);
      return cmp * sort.dir;
    });
  }, [rows, columns, sort]);


  return (
    <div className="overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[980px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-20 bg-white">
            <tr className="border-b border-[#ececf4] text-[11px] uppercase tracking-[0.1em] text-[#9b9fb3]">
              {columns.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    className={`whitespace-nowrap px-3 py-3 font-semibold ${c.align === "right" ? "text-right" : "text-left"}`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.align === "right" ? -1 : 1 }))
                      }
                      className={`inline-flex items-center gap-1 uppercase tracking-[0.1em] hover:text-[#3848c7] ${active ? "text-[#3848c7]" : ""}`}
                    >
                      {c.label}
                      {active && (sort.dir === -1 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                    </button>
                  </th>
                );
              })}
            </tr>
            <tr className="border-b border-[#ececf4] bg-[#fffbea] text-[13px] font-semibold text-[#0b1024]">
              {columns.map((c) => (
                <td key={c.key} className={`whitespace-nowrap px-3 py-2.5 tabular-nums ${c.align === "right" ? "text-right" : ""}`}>
                  {totals[c.key] ?? ""}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, limit).map((row, i) => (
              <tr key={rowKey(row, i)} className="border-b border-[#f2f3f8] last:border-0 hover:bg-[#fafbff]">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2.5 align-top tabular-nums ${c.align === "right" ? "whitespace-nowrap text-right text-[#3c4053]" : "text-[#0b1024]"} ${c.className ?? ""}`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-5 py-10 text-center text-[#9b9fb3]">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sorted.length > limit && (
        <div className="flex items-center justify-between border-t border-[#ececf4] px-5 py-3 text-[13px] text-[#6f7282]">
          Показано {nf.format(limit)} из {nf.format(sorted.length)}
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE_SIZE * 5)}
            className="rounded-xl border border-[#dcdfed] px-3 py-1.5 font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            Показать ещё
          </button>
        </div>
      )}
    </div>
  );
}

function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "muted" }) {
  const cls =
    tone === "accent"
      ? "bg-[#eef1ff] text-[#3848c7]"
      : tone === "muted"
        ? "bg-[#f5f6fa] text-[#6f7282]"
        : "border border-[#dcdfed] bg-white text-[#0b1024]";
  return <span className={`inline-flex items-center rounded-2xl px-3 py-1.5 text-[13px] font-medium ${cls}`}>{children}</span>;
}

export function QueriesClient() {
  const [days, setDays] = useState<number | null>(90);
  const [period, setPeriod] = useState(() => periodFor(90));
  const [alignGsc, setAlignGsc] = useState(true);
  const [view, setView] = useState<View>("google");
  const [goalId, setGoalId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<SearchQueriesReport | null>(null);
  const [explanations, setExplanations] = useState<[string, string][]>([]);
  const [notConfigured, setNotConfigured] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const qs = `from=${period.from}&to=${period.to}&range=${alignGsc ? "gsc" : "period"}`;

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/root/seo/queries?${qs}${refresh ? "&refresh=1" : ""}`, { cache: "no-store" });
        const data = await response.json().catch(() => null);
        if (data?.configured === false) {
          setNotConfigured(data.error ?? "Не настроено");
          setReport(null);
          return;
        }
        if (!response.ok) throw new Error(data?.error ?? "Не удалось загрузить отчёт");
        setNotConfigured(null);
        setReport(data.report);
        setExplanations(data.explanations ?? []);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Ошибка загрузки";
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    },
    [qs],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const needle = search.trim().toLowerCase();
  const googleRows = useMemo(
    () => (report?.google.rows ?? []).filter((r) => !needle || r.query.toLowerCase().includes(needle) || r.page.includes(needle)),
    [report, needle],
  );
  const pageRows = useMemo(
    () =>
      (report?.pages.rows ?? []).filter(
        (r) => !needle || r.page.toLowerCase().includes(needle) || r.topQueries.some((q) => q.toLowerCase().includes(needle)),
      ),
    [report, needle],
  );
  const yandexRows = useMemo(
    () => (report?.yandex.rows ?? []).filter((r) => !needle || r.phrase.toLowerCase().includes(needle)),
    [report, needle],
  );

  type GRow = SearchQueriesReport["google"]["rows"][number];
  type PRow = SearchQueriesReport["pages"]["rows"][number];
  type YRow = SearchQueriesReport["yandex"]["rows"][number];

  const googleColumns = useMemo<Column<GRow>[]>(
    () => [
      { key: "query", label: "Поисковая фраза", value: (r) => r.query, render: (r) => r.query, className: "min-w-[260px]" },
      { key: "page", label: "Страница входа", value: (r) => r.page, render: (r) => <PageLink page={r.page} />, className: "min-w-[180px]" },
      ...gscColumns<GRow>(),
      ...behaviorColumns<GRow>((r) => r.behavior, goalId, "Визиты стр."),
    ],
    [goalId],
  );
  const pageColumns = useMemo<Column<PRow>[]>(
    () => [
      { key: "page", label: "Страница входа", value: (r) => r.page, render: (r) => <PageLink page={r.page} />, className: "min-w-[200px]" },
      ...gscColumns<PRow>(),
      { key: "known", label: "По известным", value: (r) => r.knownClicks, render: (r) => int(r.knownClicks), align: "right" },
      { key: "queries", label: "Запросов", value: (r) => r.queriesCount, render: (r) => int(r.queriesCount), align: "right" },
      ...behaviorColumns<PRow>((r) => r.behavior, goalId),
      {
        key: "top",
        label: "Топ-5 запросов",
        value: (r) => r.topQueries.join(", "),
        render: (r) => <span className="text-[12.5px] text-[#6f7282]">{r.topQueries.join(", ")}</span>,
        className: "min-w-[300px]",
      },
    ],
    [goalId],
  );
  const yandexColumns = useMemo<Column<YRow>[]>(
    () => [
      { key: "phrase", label: "Поисковая фраза", value: (r) => r.phrase, render: (r) => r.phrase, className: "min-w-[320px]" },
      { key: "engine", label: "Система", value: (r) => r.engine, render: (r) => <span className="text-[#6f7282]">{r.engine}</span> },
      ...behaviorColumns<YRow>((r) => r.behavior, goalId),
    ],
    [goalId],
  );

  function behaviorTotals(b: Behavior | undefined): Record<string, ReactNode> {
    if (!b) return {};
    const reaches = goalId == null ? b.reaches : (b.goals[goalId]?.reaches ?? 0);
    const conv = goalId == null ? b.conversion : (b.goals[goalId]?.conversion ?? 0);
    return {
      visits: int(b.visits),
      users: int(b.users),
      bounce: pct(b.bounceRate),
      depth: dec(b.pageDepth, 2),
      time: mmss(b.duration),
      reaches: int(reaches),
      conv: pct(conv),
    };
  }

  const r = report;
  const controlCls =
    "h-10 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13.5px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-2xl border border-[#dcdfed] bg-white p-1">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => {
                setDays(w.days);
                setPeriod(periodFor(w.days));
              }}
              className={`rounded-xl px-3 py-1.5 text-[13px] font-medium ${days === w.days ? "bg-[#eef1ff] text-[#3848c7]" : "text-[#3c4053] hover:bg-[#f5f6ff]"}`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={period.from}
          max={period.to}
          onChange={(e) => {
            if (!e.target.value) return;
            setDays(null);
            setPeriod((p) => ({ ...p, from: e.target.value }));
          }}
          className={controlCls}
          aria-label="Начало периода"
        />
        <span className="text-[#9b9fb3]">—</span>
        <input
          type="date"
          value={period.to}
          min={period.from}
          onChange={(e) => {
            if (!e.target.value) return;
            setDays(null);
            setPeriod((p) => ({ ...p, to: e.target.value }));
          }}
          className={controlCls}
          aria-label="Конец периода"
        />
        <label
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13.5px] text-[#0b1024]"
          title="Поведение Google из Метрики берётся только за дни, за которые в Search Console есть данные, — так клики и визиты сравнимы"
        >
          <input
            type="checkbox"
            checked={alignGsc}
            onChange={(e) => setAlignGsc(e.target.checked)}
            className="size-4 accent-[#5566f6]"
          />
          Метрика за дни GSC
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-4 animate-spin text-[#5566f6]" /> : <RefreshCw className="size-4 text-[#5566f6]" />}
            Обновить
          </button>
          <a
            href={`/api/root/seo/queries/export?${qs}`}
            aria-disabled={!r}
            className={`inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[13.5px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] ${r ? "" : "pointer-events-none opacity-60"}`}
          >
            <Download className="size-4" />
            Скачать Excel
          </a>
        </div>
      </div>

      {notConfigured && (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center text-[14px] text-[#6f7282]">
          {notConfigured}. Задайте METRIKA_TOKEN, METRIKA_COUNTER_ID и GSC_SERVICE_ACCOUNT_KEY в .env на сервере.
        </div>
      )}

      {error && !r && (
        <div className="rounded-2xl border border-[#f5c2c2] bg-[#fff5f5] px-4 py-3 text-[13.5px] text-[#a12c2c]">{error}</div>
      )}

      {loading && !r && (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <Loader2 className="mx-auto mb-3 size-6 animate-spin text-[#5566f6]" />
          <div className="text-[14px] text-[#6f7282]">Собираем отчёт из Search Console и Метрики — обычно 10–30 секунд…</div>
        </div>
      )}

      {r && (
        <>
          {r.warnings.map((w) => (
            <div
              key={w}
              className="flex items-start gap-2.5 rounded-2xl border border-[#f3dfa7] bg-[#fffbea] px-4 py-3 text-[13.5px] leading-relaxed text-[#6b5310]"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{w}</span>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            {r.gsc.connected && (
              <>
                <Pill tone="accent">
                  GSC: {int(r.gsc.totalClicks)} кликов · {int(r.gsc.totalImpressions)} показов
                </Pill>
                <Pill>
                  Известные запросы: {int(r.google.totals.clicks)} кликов ({pct(r.gsc.totalClicks ? r.google.totals.clicks / r.gsc.totalClicks : 0)})
                </Pill>
                <Pill tone="muted">
                  Данные GSC: {ruDate(r.gsc.firstDay)} — {ruDate(r.gsc.lastDay)}
                </Pill>
              </>
            )}
            <Pill>
              Метрика, Google: {int(r.google.totals.behavior.visits)} визитов
              {r.metrikaGoogle.aligned ? ` (${ruDate(r.metrikaGoogle.from)} — ${ruDate(r.metrikaGoogle.to)})` : ""}
            </Pill>
            <Pill>
              Метрика, Яндекс: {int(r.yandex.visitsAll)} визитов, с фразой {int(r.yandex.totals.visits)}
            </Pill>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap rounded-2xl border border-[#dcdfed] bg-white p-1">
              {VIEWS.map((v) => {
                const count =
                  v.id === "google" ? r.google.rows.length : v.id === "pages" ? r.pages.rows.length : v.id === "yandex" ? r.yandex.rows.length : null;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setView(v.id)}
                    className={`rounded-xl px-3 py-1.5 text-[13px] font-medium ${view === v.id ? "bg-[#eef1ff] text-[#3848c7]" : "text-[#3c4053] hover:bg-[#f5f6ff]"}`}
                  >
                    {v.label}
                    {count != null && <span className="ml-1.5 text-[11.5px] text-[#9b9fb3]">{nf.format(count)}</span>}
                  </button>
                );
              })}
            </div>
            {view !== "notes" && (
              <>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={view === "pages" ? "Поиск по странице или запросу" : "Поиск по фразе"}
                  className={`${controlCls} w-[240px] px-4 placeholder:text-[#9b9fb3]`}
                />
                <select
                  value={goalId ?? ""}
                  onChange={(e) => setGoalId(e.target.value ? Number(e.target.value) : null)}
                  className={`${controlCls} max-w-[300px]`}
                  aria-label="Цель для колонок «Цели» и «Конверсия»"
                >
                  <option value="">Любая цель</option>
                  {r.goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            {loading && <Loader2 className="size-4 animate-spin text-[#5566f6]" />}
          </div>

          {view === "google" && (
            <>
              {!r.gsc.connected ? (
                <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center text-[14px] text-[#6f7282]">
                  {r.gsc.error ?? "Search Console не подключена"}
                </div>
              ) : (
                <SortableTable
              key={`${needle}|${r.generatedAt}`}
                  columns={googleColumns}
                  rows={googleRows}
                  initialSort="clicks"
                  rowKey={(row) => `${row.query}\u0001${row.page}`}
                  totals={{
                    query: "Итого и средние",
                    page: `${nf.format(r.google.totals.pairs)} пар`,
                    clicks: int(r.google.totals.clicks),
                    impr: int(r.google.totals.impressions),
                    ctr: pct(r.google.totals.ctr),
                    pos: dec(r.google.totals.position),
                    ...behaviorTotals(r.google.totals.behavior),
                  }}
                />
              )}
              <p className="text-[12.5px] leading-relaxed text-[#9b9fb3]">
                Визиты, отказы, время и цели относятся к странице входа, а не к фразе: у всех запросов одной страницы они одинаковые
                и между запросами не делятся.
              </p>
            </>
          )}

          {view === "pages" && (
            <SortableTable
              key={`${needle}|${r.generatedAt}`}
              columns={pageColumns}
              rows={pageRows}
              initialSort="clicks"
              rowKey={(row) => row.page}
              totals={{
                page: "Итого и средние",
                clicks: int(r.pages.totals.clicks),
                impr: int(r.pages.totals.impressions),
                ctr: pct(r.pages.totals.ctr),
                pos: dec(r.pages.totals.position),
                known: int(r.pages.totals.knownClicks),
                queries: int(r.pages.totals.queriesCount),
                ...behaviorTotals(r.pages.totals.behavior),
              }}
            />
          )}

          {view === "yandex" && (
            <SortableTable
              key={`${needle}|${r.generatedAt}`}
              columns={yandexColumns}
              rows={yandexRows}
              initialSort="visits"
              rowKey={(row) => `${row.phrase}\u0001${row.engine}`}
              totals={{ phrase: "Итого и средние", ...behaviorTotals(r.yandex.totals) }}
            />
          )}

          {view === "notes" && (
            <div className="divide-y divide-[#f2f3f8] rounded-3xl border border-[#ececf4] bg-white">
              {explanations.map(([k, v], i) => (
                <div key={i} className="grid gap-1 px-5 py-3 text-[13.5px] md:grid-cols-[220px_1fr] md:gap-4">
                  <div className="font-medium text-[#0b1024]">{k}</div>
                  <div className="leading-relaxed text-[#3c4053]">{v}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

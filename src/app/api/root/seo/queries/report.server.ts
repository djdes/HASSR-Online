import {
  defaultPeriod,
  loadSearchQueriesReport,
  type MetrikaRange,
  type SearchQueriesReport,
} from "@/lib/seo/search-queries.server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;
const TTL_MS = 30 * 60 * 1000;

export type ReportParams = { from: string; to: string; metrikaRange: MetrikaRange };

/** Разбор ?from&to&range из URL; ошибка — строка для ответа 400. */
export function parseReportParams(url: URL): ReportParams | string {
  const def = defaultPeriod(90);
  const from = url.searchParams.get("from") || def.from;
  const to = url.searchParams.get("to") || def.to;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return "Даты — в формате ГГГГ-ММ-ДД";
  if (from > to) return "Начало периода позже конца";
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS) return `Период не длиннее ${MAX_DAYS} дней`;
  const range = url.searchParams.get("range") ?? "gsc";
  if (range !== "gsc" && range !== "period") return "range: gsc или period";
  return { from, to, metrikaRange: range };
}

// Отчёт — это ~10 запросов к Метрике и Search Console, поэтому держим его
// в памяти процесса полчаса. Одинаковые запросы в полёте не дублируются.
const cache = new Map<string, { at: number; promise: Promise<SearchQueriesReport> }>();

export function getCachedReport(p: ReportParams, refresh = false): Promise<SearchQueriesReport> {
  const key = `${p.from}|${p.to}|${p.metrikaRange}`;
  const hit = cache.get(key);
  if (hit && !refresh && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = loadSearchQueriesReport(p);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  for (const [k, v] of cache) if (Date.now() - v.at > TTL_MS) cache.delete(k);
  return promise;
}

/**
 * Поисковые запросы Google и Яндекса в формате отчёта Метрики «Поисковые фразы».
 *
 * Google не передаёт фразы в Метрику (not provided), поэтому запросы берём из
 * Search Console (запрос → страница), а поведение — из Метрики по странице входа
 * для визитов из Google, и склеиваем по нормализованному URL. Яндекс отдаёт
 * фразы в Метрику сам — его отчёт берём напрямую.
 *
 * Используется страницей /root/seo/queries (через /api/root/seo/queries) и
 * скриптом `npm run seo:export` (scripts/seo-queries-export.ts).
 *
 * Переменные окружения:
 *   GSC_SERVICE_ACCOUNT_KEY  путь к JSON-ключу сервисного аккаунта Google
 *   GSC_SITE_URL             ресурс Search Console: https://wesetup.ru/ или sc-domain:wesetup.ru
 *   METRIKA_TOKEN            OAuth-токен Яндекса с правом metrika:read
 *   METRIKA_COUNTER_ID       номер счётчика (по умолчанию NEXT_PUBLIC_YANDEX_METRIKA_ID)
 *   METRIKA_GOAL_IDS         через запятую; пусто — все активные цели счётчика
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

import ExcelJS from "exceljs";

// ---------- конфигурация ----------

export type SearchQueriesConfig = {
  metrikaToken: string | null;
  counterId: string | null;
  goalIds: number[];
  gscKeyPath: string | null;
  gscSiteUrl: string;
};

export function readSearchQueriesConfig(env: NodeJS.ProcessEnv = process.env): SearchQueriesConfig {
  const clean = (v: string | undefined) => v?.trim().replace(/^"(.*)"$/, "$1") || null;
  return {
    metrikaToken: clean(env.METRIKA_TOKEN),
    counterId: clean(env.METRIKA_COUNTER_ID) ?? clean(env.NEXT_PUBLIC_YANDEX_METRIKA_ID),
    goalIds: (env.METRIKA_GOAL_IDS ?? "")
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0),
    gscKeyPath: clean(env.GSC_SERVICE_ACCOUNT_KEY),
    gscSiteUrl: clean(env.GSC_SITE_URL) ?? "https://wesetup.ru/",
  };
}

// ---------- нормализация URL ----------

/** wesetup.ru/blanki — без протокола, www, query, #hash, завершающего слэша; корень — wesetup.ru/ */
export function normalizeUrl(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  let host: string;
  let pathname: string;
  try {
    const u = new URL(s);
    host = u.hostname.toLowerCase().replace(/^www\./, "");
    pathname = u.pathname;
  } catch {
    const m = s.replace(/^[a-z]+:\/\//i, "").split(/[?#]/)[0];
    const slash = m.indexOf("/");
    host = (slash < 0 ? m : m.slice(0, slash)).toLowerCase().replace(/^www\./, "");
    pathname = slash < 0 ? "/" : m.slice(slash);
  }
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    /* битая кодировка — оставляем как есть */
  }
  pathname = pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return `${host}${pathname || "/"}`;
}

// ---------- HTTP ----------

async function fetchJson<T>(url: string, init: RequestInit, what: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    if (res.ok) return JSON.parse(text) as T;
    const retriable = res.status === 429 || res.status >= 500;
    if (retriable && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    throw new Error(`${what}: HTTP ${res.status} ${text.slice(0, 400)}`);
  }
}

// ---------- Google Search Console ----------

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

async function googleAccessToken(keyPath: string): Promise<string> {
  const sa = JSON.parse(readFileSync(keyPath, "utf8")) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) throw new Error(`${keyPath}: это не JSON-ключ сервисного аккаунта`);
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${unsigned}.${signature}`,
  });
  const json = await fetchJson<{ access_token: string }>(
    tokenUri,
    { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } },
    "Google OAuth",
  );
  return json.access_token;
}

type GscRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };

async function gscQuery(token: string, siteUrl: string, body: object): Promise<GscRow[]> {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const json = await fetchJson<{ rows?: GscRow[] }>(
    url,
    { method: "POST", body: JSON.stringify(body), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } },
    `Search Console (${siteUrl})`,
  );
  return json.rows ?? [];
}

async function gscQueryAll(token: string, siteUrl: string, body: object, onPage?: (from: number, n: number) => void) {
  const rows: GscRow[] = [];
  const rowLimit = 25_000;
  for (let startRow = 0; ; startRow += rowLimit) {
    const page = await gscQuery(token, siteUrl, { ...body, rowLimit, startRow });
    rows.push(...page);
    onPage?.(startRow, page.length);
    if (page.length < rowLimit) break;
  }
  return rows;
}

async function loadGsc(keyPath: string, siteUrl: string, from: string, to: string, log: (s: string) => void) {
  const token = await googleAccessToken(keyPath);
  const base = { startDate: from, endDate: to, type: "web" };
  const pairs = await gscQueryAll(token, siteUrl, { ...base, dimensions: ["query", "page"] }, (s, n) =>
    log(`  GSC: строки ${s + 1}…${s + n}`),
  );
  // По страницам без запроса: сюда входят и анонимизированные запросы, поэтому клики по странице полные.
  const pages = await gscQueryAll(token, siteUrl, { ...base, dimensions: ["page"] });
  // Итог без измерений — совпадает с графиком в интерфейсе GSC (с анонимизированными запросами).
  const [total] = await gscQuery(token, siteUrl, base);
  // За какие дни в GSC реально есть данные: ресурс мог появиться позже начала периода,
  // а последние 2–3 дня Google ещё не обработал.
  const days = (await gscQuery(token, siteUrl, { ...base, dimensions: ["date"], rowLimit: 25_000 })).map((r) => r.keys![0]).sort();
  return {
    pairs,
    pages,
    total: total ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    firstDay: days[0] ?? null,
    lastDay: days.at(-1) ?? null,
  };
}

// ---------- Яндекс Метрика ----------

export type Goal = { id: number; name: string };

const BASE_METRICS = [
  "ym:s:visits",
  "ym:s:users",
  "ym:s:bounceRate",
  "ym:s:pageDepth",
  "ym:s:avgVisitDurationSeconds",
  "ym:s:sumGoalReachesAny",
  "ym:s:anyGoalConversionRate",
] as const;

export const METRIKA_GOOGLE_FILTER = "ym:s:lastsignSearchEngineRoot=='google'";
export const METRIKA_YANDEX_FILTER = "ym:s:lastsignSearchEngineRoot=='yandex'";

type MetrikaRow = { dims: string[]; m: Record<string, number> };
type MetrikaResult = { rows: MetrikaRow[]; totals: Record<string, number> };

class Metrika {
  constructor(
    private token: string,
    private counterId: string,
  ) {}

  private get headers() {
    return { authorization: `OAuth ${this.token}` };
  }

  async goals(ids: number[]): Promise<Goal[]> {
    const json = await fetchJson<{ goals: (Goal & { status?: string })[] }>(
      `https://api-metrika.yandex.net/management/v1/counter/${this.counterId}/goals`,
      { headers: this.headers },
      "Метрика: цели",
    );
    const all = json.goals.filter((g) => !g.status || g.status === "Active").map((g) => ({ id: g.id, name: g.name }));
    if (!ids.length) return all;
    return ids.map((id) => all.find((g) => g.id === id) ?? { id, name: `Цель ${id}` });
  }

  /** Все строки отчёта; метрики делятся на пачки по 20 (лимит API), строки — по offset/limit. */
  async report(from: string, to: string, dimensions: string[], metrics: string[], filters: string): Promise<MetrikaResult> {
    const byKey = new Map<string, MetrikaRow>();
    const totals: Record<string, number> = {};
    for (let i = 0; i < metrics.length; i += 20) {
      const chunk = metrics.slice(i, i + 20);
      const limit = 100_000;
      for (let offset = 1; ; offset += limit) {
        const qs = new URLSearchParams({
          ids: this.counterId,
          date1: from,
          date2: to,
          metrics: chunk.join(","),
          filters,
          accuracy: "full",
          lang: "ru",
          limit: String(limit),
          offset: String(offset),
          sort: `-${chunk[0]}`,
        });
        if (dimensions.length) qs.set("dimensions", dimensions.join(","));
        const json = await fetchJson<{
          data: { dimensions: { name: string | null }[]; metrics: number[] }[];
          totals: number[];
          total_rows: number;
        }>(`https://api-metrika.yandex.net/stat/v1/data?${qs}`, { headers: this.headers }, "Метрика: отчёт");
        if (offset === 1) chunk.forEach((m, j) => (totals[m] = json.totals[j] ?? 0));
        for (const r of json.data) {
          const dims = r.dimensions.map((d) => d.name ?? "");
          const key = dims.join("\u0001");
          const row = byKey.get(key) ?? { dims, m: {} };
          chunk.forEach((m, j) => (row.m[m] = r.metrics[j] ?? 0));
          byKey.set(key, row);
        }
        if (offset + json.data.length > json.total_rows || json.data.length === 0) break;
      }
    }
    return { rows: [...byKey.values()], totals };
  }
}

// ---------- поведение ----------

/** Поведение: суммы и средневзвешенные по визитам (как считает Метрика). Доли — 0..1, время — секунды. */
export type Behavior = {
  visits: number;
  users: number;
  bounceRate: number;
  pageDepth: number;
  duration: number;
  reaches: number;
  conversion: number;
  goals: Record<number, { reaches: number; conversion: number }>;
};

function behaviorFrom(m: Record<string, number>, goals: Goal[]): Behavior {
  const b: Behavior = {
    visits: m["ym:s:visits"] ?? 0,
    users: m["ym:s:users"] ?? 0,
    bounceRate: (m["ym:s:bounceRate"] ?? 0) / 100,
    pageDepth: m["ym:s:pageDepth"] ?? 0,
    duration: m["ym:s:avgVisitDurationSeconds"] ?? 0,
    reaches: m["ym:s:sumGoalReachesAny"] ?? 0,
    conversion: (m["ym:s:anyGoalConversionRate"] ?? 0) / 100,
    goals: {},
  };
  for (const g of goals) {
    b.goals[g.id] = {
      reaches: m[`ym:s:goal${g.id}reaches`] ?? 0,
      conversion: (m[`ym:s:goal${g.id}conversionRate`] ?? 0) / 100,
    };
  }
  return b;
}

/** Склейка нескольких исходных startURL (например, с UTM) в одну нормализованную страницу. */
export function mergeBehavior(a: Behavior, b: Behavior): Behavior {
  const v = a.visits + b.visits;
  const w = (x: number, y: number) => (v ? (x * a.visits + y * b.visits) / v : 0);
  const goals: Behavior["goals"] = {};
  for (const id of new Set([...Object.keys(a.goals), ...Object.keys(b.goals)].map(Number))) {
    const ga = a.goals[id] ?? { reaches: 0, conversion: 0 };
    const gb = b.goals[id] ?? { reaches: 0, conversion: 0 };
    goals[id] = { reaches: ga.reaches + gb.reaches, conversion: w(ga.conversion, gb.conversion) };
  }
  return {
    visits: v,
    users: a.users + b.users, // посетители по разным URL могут пересекаться — сумма приблизительная
    bounceRate: w(a.bounceRate, b.bounceRate),
    pageDepth: w(a.pageDepth, b.pageDepth),
    duration: w(a.duration, b.duration),
    reaches: a.reaches + b.reaches,
    conversion: w(a.conversion, b.conversion),
    goals,
  };
}

// ---------- отчёт ----------

export type GscMetrics = { clicks: number; impressions: number; ctr: number; position: number | null };

export type GoogleQueryRow = GscMetrics & { query: string; page: string; behavior: Behavior | null };
export type GooglePageRow = GscMetrics & {
  page: string;
  knownClicks: number;
  queriesCount: number;
  topQueries: string[];
  behavior: Behavior | null;
};
export type YandexPhraseRow = { phrase: string; engine: string; behavior: Behavior };

export type MetrikaRange = "period" | "gsc";

export type SearchQueriesReport = {
  from: string;
  to: string;
  generatedAt: string;
  siteUrl: string;
  counterId: string;
  goals: Goal[];
  gsc: {
    connected: boolean;
    error: string | null;
    firstDay: string | null;
    lastDay: string | null;
    totalClicks: number;
    totalImpressions: number;
  };
  /** Период, за который взято поведение Google из Метрики. */
  metrikaGoogle: { from: string; to: string; aligned: boolean; visitsFullPeriod: number };
  google: { totals: GscMetrics & { pairs: number; behavior: Behavior }; rows: GoogleQueryRow[] };
  pages: { totals: GscMetrics & { knownClicks: number; queriesCount: number; behavior: Behavior }; rows: GooglePageRow[] };
  yandex: { totals: Behavior; visitsAll: number; rows: YandexPhraseRow[] };
  warnings: string[];
};

export type SearchQueriesOptions = {
  from: string;
  to: string;
  /** "gsc" — поведение Google из Метрики только за дни, за которые есть данные в Search Console. */
  metrikaRange?: MetrikaRange;
  skipGsc?: boolean;
  log?: (line: string) => void;
};

export class SearchQueriesConfigError extends Error {}

function gscTotals(rows: { clicks: number; impressions: number; position: number }[]): GscMetrics {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions : null,
  };
}

export async function loadSearchQueriesReport(
  opts: SearchQueriesOptions,
  config: SearchQueriesConfig = readSearchQueriesConfig(),
): Promise<SearchQueriesReport> {
  const log = opts.log ?? (() => {});
  const { from, to } = opts;
  if (!config.metrikaToken || !config.counterId) {
    throw new SearchQueriesConfigError("Не заданы METRIKA_TOKEN и/или METRIKA_COUNTER_ID");
  }
  const warnings: string[] = [];
  const metrika = new Metrika(config.metrikaToken, config.counterId);
  const goals = await metrika.goals(config.goalIds);
  log(`Цели Метрики (${goals.length}): ${goals.map((g) => g.name).join("; ")}`);
  const metrics = [...BASE_METRICS, ...goals.flatMap((g) => [`ym:s:goal${g.id}reaches`, `ym:s:goal${g.id}conversionRate`])];

  // Search Console — первой: от неё зависит период Метрики при metrikaRange = "gsc".
  let gsc: Awaited<ReturnType<typeof loadGsc>> | null = null;
  let gscError: string | null = null;
  if (!opts.skipGsc) {
    if (!config.gscKeyPath) {
      gscError = "Search Console не подключена: не задан GSC_SERVICE_ACCOUNT_KEY";
    } else {
      log(`Search Console: ${config.gscSiteUrl}…`);
      try {
        gsc = await loadGsc(config.gscKeyPath, config.gscSiteUrl, from, to, log);
      } catch (e) {
        gscError = e instanceof Error ? e.message : String(e);
      }
    }
    if (gscError) warnings.push(gscError);
  }

  let gFrom = from;
  let gTo = to;
  const gscNarrower = Boolean(gsc?.firstDay && gsc.lastDay && (gsc.firstDay > from || gsc.lastDay < to));
  if (opts.metrikaRange === "gsc" && gsc?.firstDay && gsc.lastDay) {
    gFrom = gsc.firstDay;
    gTo = gsc.lastDay;
  }
  const aligned = gFrom !== from || gTo !== to;

  log(`Метрика: Google по страницам входа (${gFrom} — ${gTo})…`);
  const gPages = await metrika.report(gFrom, gTo, ["ym:s:startURL"], metrics, METRIKA_GOOGLE_FILTER);
  const visitsFullPeriod = aligned
    ? ((await metrika.report(from, to, [], ["ym:s:visits"], METRIKA_GOOGLE_FILTER)).totals["ym:s:visits"] ?? 0)
    : (gPages.totals["ym:s:visits"] ?? 0);
  log("Метрика: Яндекс по поисковым фразам…");
  const yPhrases = await metrika.report(
    from,
    to,
    ["ym:s:lastsignSearchPhrase", "ym:s:lastsignSearchEngine"],
    metrics,
    METRIKA_YANDEX_FILTER,
  );
  const yAll = await metrika.report(from, to, [], ["ym:s:visits"], METRIKA_YANDEX_FILTER);

  const behaviorByPage = new Map<string, Behavior>();
  for (const r of gPages.rows) {
    const key = normalizeUrl(r.dims[0]);
    const b = behaviorFrom(r.m, goals);
    const prev = behaviorByPage.get(key);
    behaviorByPage.set(key, prev ? mergeBehavior(prev, b) : b);
  }
  const googleBehavior = behaviorFrom(gPages.totals, goals);

  if (gsc && gscNarrower) {
    warnings.push(
      `В Search Console есть данные только за ${gsc.firstDay} — ${gsc.lastDay} (запрошено ${from} — ${to}): ` +
        `ресурс добавлен позже начала периода и/или Google ещё не обработал последние дни. ` +
        (aligned
          ? `Поведение Google из Метрики взято за те же дни (${googleBehavior.visits} визитов из Google; за весь период — ${visitsFullPeriod}).`
          : `Поведение Google из Метрики — за весь период (${visitsFullPeriod} визитов); чтобы сравнивать с кликами честно, берите Метрику за дни GSC.`),
    );
  }

  // ----- Google: запросы -----
  const queryRows: GoogleQueryRow[] = (gsc?.pairs ?? [])
    .map((r) => {
      const page = normalizeUrl(r.keys![1]);
      return {
        query: r.keys![0],
        page,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
        behavior: behaviorByPage.get(page) ?? null,
      };
    })
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || (a.position ?? 0) - (b.position ?? 0));
  const pairTotals = gscTotals((gsc?.pairs ?? []).map((r) => r));

  // ----- Google: страницы -----
  const pageAgg = new Map<string, { clicks: number; impressions: number; posW: number }>();
  for (const r of gsc?.pages ?? []) {
    const key = normalizeUrl(r.keys![0]);
    const p = pageAgg.get(key) ?? { clicks: 0, impressions: 0, posW: 0 };
    p.clicks += r.clicks;
    p.impressions += r.impressions;
    p.posW += r.position * r.impressions;
    pageAgg.set(key, p);
  }
  const pageQueries = new Map<string, GoogleQueryRow[]>();
  for (const r of queryRows) {
    const list = pageQueries.get(r.page) ?? [];
    list.push(r);
    pageQueries.set(r.page, list);
  }
  const pageRows: GooglePageRow[] = [...new Set([...pageAgg.keys(), ...pageQueries.keys(), ...behaviorByPage.keys()])]
    .map((page) => {
      const p = pageAgg.get(page);
      const qs = pageQueries.get(page) ?? [];
      return {
        page,
        clicks: p?.clicks ?? 0,
        impressions: p?.impressions ?? 0,
        ctr: p?.impressions ? p.clicks / p.impressions : 0,
        position: p?.impressions ? p.posW / p.impressions : null,
        knownClicks: qs.reduce((s, q) => s + q.clicks, 0),
        queriesCount: qs.length,
        // queryRows уже отсортированы по кликам — первые пять и есть топ.
        topQueries: qs.slice(0, 5).map((q) => q.query),
        behavior: behaviorByPage.get(page) ?? null,
      };
    })
    .sort((a, b) => b.clicks - a.clicks || (b.behavior?.visits ?? 0) - (a.behavior?.visits ?? 0) || b.impressions - a.impressions);
  const pageTotals = gscTotals([...pageAgg.values()].map((p) => ({ ...p, position: p.impressions ? p.posW / p.impressions : 0 })));

  // ----- Яндекс: фразы -----
  const yandexRows: YandexPhraseRow[] = yPhrases.rows
    .map((r) => ({ phrase: r.dims[0], engine: r.dims[1], behavior: behaviorFrom(r.m, goals) }))
    .sort((a, b) => b.behavior.visits - a.behavior.visits || a.phrase.localeCompare(b.phrase, "ru"));

  return {
    from,
    to,
    generatedAt: new Date().toISOString(),
    siteUrl: config.gscSiteUrl,
    counterId: config.counterId,
    goals,
    gsc: {
      connected: Boolean(gsc),
      error: gscError,
      firstDay: gsc?.firstDay ?? null,
      lastDay: gsc?.lastDay ?? null,
      totalClicks: gsc?.total.clicks ?? 0,
      totalImpressions: gsc?.total.impressions ?? 0,
    },
    metrikaGoogle: { from: gFrom, to: gTo, aligned, visitsFullPeriod },
    google: { totals: { ...pairTotals, pairs: queryRows.length, behavior: googleBehavior }, rows: queryRows },
    pages: {
      totals: { ...pageTotals, knownClicks: pairTotals.clicks, queriesCount: queryRows.length, behavior: googleBehavior },
      rows: pageRows,
    },
    yandex: { totals: behaviorFrom(yPhrases.totals, goals), visitsAll: yAll.totals["ym:s:visits"] ?? 0, rows: yandexRows },
    warnings,
  };
}

// ---------- Excel ----------

type Col = { header: string; key: string; width: number; fmt?: string };

const FMT = { int: "#,##0", pct: "0.00%", pos: "0.0", depth: "0.00", time: "[mm]:ss" };

function behaviorCols(goals: Goal[], visitsSuffix = ""): Col[] {
  return [
    { header: `Визиты${visitsSuffix}`, key: "visits", width: 11, fmt: FMT.int },
    { header: "Посетители", key: "users", width: 12, fmt: FMT.int },
    { header: "Отказы", key: "bounceRate", width: 10, fmt: FMT.pct },
    { header: "Глубина просмотра", key: "pageDepth", width: 11, fmt: FMT.depth },
    { header: "Время на сайте", key: "duration", width: 10, fmt: FMT.time },
    { header: "Достижения целей", key: "reaches", width: 12, fmt: FMT.int },
    { header: "Конверсия", key: "conversion", width: 11, fmt: FMT.pct },
    ...goals.flatMap((g) => [
      { header: `${g.name}: достижения`, key: `g${g.id}r`, width: 14, fmt: FMT.int },
      { header: `${g.name}: конверсия`, key: `g${g.id}c`, width: 14, fmt: FMT.pct },
    ]),
  ];
}

function behaviorValues(b: Behavior | null, goals: Goal[]): Record<string, number> {
  if (!b) return {};
  const out: Record<string, number> = {
    visits: b.visits,
    users: b.users,
    bounceRate: b.bounceRate,
    pageDepth: b.pageDepth,
    duration: b.duration / 86_400, // доля суток — так Excel хранит время
    reaches: b.reaches,
    conversion: b.conversion,
  };
  for (const g of goals) {
    out[`g${g.id}r`] = b.goals[g.id]?.reaches ?? 0;
    out[`g${g.id}c`] = b.goals[g.id]?.conversion ?? 0;
  }
  return out;
}

const gscCols: Col[] = [
  { header: "Клики (GSC)", key: "clicks", width: 10, fmt: FMT.int },
  { header: "Показы", key: "impressions", width: 11, fmt: FMT.int },
  { header: "CTR", key: "ctr", width: 9, fmt: FMT.pct },
  { header: "Средняя позиция", key: "position", width: 10, fmt: FMT.pos },
];

/**
 * Лист: строка «Итого и средние» сверху, под ней жирная шапка с автофильтром,
 * обе строки закреплены, данные — с третьей строки. Итоги стоят над фильтром,
 * чтобы сортировка и фильтрация в Excel их не задевали.
 */
function addSheet(wb: ExcelJS.Workbook, name: string, cols: Col[], totals: Record<string, unknown>, rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 2 }] });
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));
  const tot = ws.addRow(totals);
  tot.font = { bold: true };
  tot.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6D6" } };
  const head = ws.addRow(cols.map((c) => c.header));
  head.font = { bold: true };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 45;
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF1F5" } };
  for (const r of rows) ws.addRow(r);
  cols.forEach((c, i) => {
    if (c.fmt) ws.getColumn(i + 1).numFmt = c.fmt;
  });
  head.eachCell((cell) => (cell.numFmt = "General"));
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: Math.max(3, ws.rowCount), column: cols.length } };
}

export function buildSearchQueriesWorkbook(r: SearchQueriesReport): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "WeSetup seo-queries-export";
  wb.created = new Date();
  const { goals } = r;
  const gNote = r.metrikaGoogle.aligned ? ` (Метрика ${r.metrikaGoogle.from} — ${r.metrikaGoogle.to})` : "";

  addSheet(
    wb,
    "Google — запросы",
    [
      { header: "Поисковая фраза", key: "query", width: 46 },
      { header: "Страница входа", key: "page", width: 34 },
      ...gscCols,
      ...behaviorCols(goals, ` (Метрика, по странице)${gNote}`),
    ],
    {
      query: "Итого и средние",
      page: r.gsc.connected ? `${r.google.totals.pairs} пар «запрос — страница»` : "Search Console не подключена",
      clicks: r.google.totals.clicks,
      impressions: r.google.totals.impressions,
      ctr: r.google.totals.ctr,
      position: r.google.totals.position ?? 0,
      ...behaviorValues(r.google.totals.behavior, goals),
    },
    r.google.rows.map((q) => ({
      query: q.query,
      page: q.page,
      clicks: q.clicks,
      impressions: q.impressions,
      ctr: q.ctr,
      position: q.position,
      ...behaviorValues(q.behavior, goals),
    })),
  );

  addSheet(
    wb,
    "Google — страницы",
    [
      { header: "Страница входа", key: "page", width: 40 },
      ...gscCols,
      { header: "Клики по известным запросам", key: "knownClicks", width: 12, fmt: FMT.int },
      { header: "Запросов (GSC)", key: "queriesCount", width: 10, fmt: FMT.int },
      ...behaviorCols(goals, ` (Метрика)${gNote}`),
      { header: "Топ-5 запросов", key: "top", width: 80 },
    ],
    {
      page: "Итого и средние",
      clicks: r.pages.totals.clicks,
      impressions: r.pages.totals.impressions,
      ctr: r.pages.totals.ctr,
      position: r.pages.totals.position ?? 0,
      knownClicks: r.pages.totals.knownClicks,
      queriesCount: r.pages.totals.queriesCount,
      ...behaviorValues(r.pages.totals.behavior, goals),
      top: "",
    },
    r.pages.rows.map((p) => ({
      page: p.page,
      clicks: p.clicks,
      impressions: p.impressions,
      ctr: p.ctr,
      position: p.position,
      knownClicks: p.knownClicks,
      queriesCount: p.queriesCount,
      ...behaviorValues(p.behavior, goals),
      top: p.topQueries.join(", "),
    })),
  );

  addSheet(
    wb,
    "Яндекс — фразы",
    [
      { header: "Поисковая фраза", key: "phrase", width: 50 },
      { header: "Поисковая система", key: "engine", width: 22 },
      ...behaviorCols(goals),
    ],
    { phrase: "Итого и средние", engine: "", ...behaviorValues(r.yandex.totals, goals) },
    r.yandex.rows.map((y) => ({ phrase: y.phrase, engine: y.engine, ...behaviorValues(y.behavior, goals) })),
  );

  const notes = wb.addWorksheet("Пояснения");
  notes.columns = [{ width: 34 }, { width: 110 }];
  for (const [k, v] of explanationLines(r)) {
    const row = notes.addRow([k, v]);
    row.getCell(1).font = { bold: true };
    row.alignment = { vertical: "top", wrapText: true };
  }
  return wb;
}

/** Текст пояснений — общий для листа Excel и страницы в панели. */
export function explanationLines(r: SearchQueriesReport): [string, string][] {
  const goalList = r.goals.map((g) => `${g.name} (${g.id})`).join("; ");
  return [
    ["Период", `${r.from} — ${r.to}`],
    ...r.warnings.map((w) => ["Внимание", w] as [string, string]),
    [
      "Сформировано",
      new Date(r.generatedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) + " (МСК)",
    ],
    [
      "Источник запросов Google",
      r.gsc.connected
        ? `Google Search Console, ресурс ${r.siteUrl}, searchanalytics.query, измерения query+page, тип web`
        : "Search Console не подключена",
    ],
    [
      "Источник поведения",
      `Яндекс Метрика, счётчик ${r.counterId}, Reporting API, accuracy=full, атрибуция «последний значимый переход» (ym:s:lastsign…)` +
        (r.metrikaGoogle.aligned
          ? `. Поведение Google — за ${r.metrikaGoogle.from} — ${r.metrikaGoogle.to}, те же дни, что и данные Search Console.`
          : ""),
    ],
    [
      "Почему так",
      "Google не передаёт поисковую фразу сайту (not provided), поэтому в Метрике фраз из Google нет. Фразы и клики берём из Search Console, а поведение — из Метрики по странице входа для визитов из Google, и склеиваем по URL.",
    ],
    [
      "Важно",
      "Визиты, посетители, отказы, глубина, время и цели в листе «Google — запросы» относятся к СТРАНИЦЕ ВХОДА, а не к конкретной фразе. Если на страницу ведут несколько запросов, у всех этих строк одинаковые поведенческие цифры: визиты между запросами не делятся, и складывать их по строкам нельзя.",
    ],
    [
      "Строка «Итого и средние»",
      "Клики и показы — сумма по строкам, CTR = клики / показы, позиция — средневзвешенная по показам. Поведенческие итоги — общие цифры Метрики по всем визитам из Google за период (а не сумма по строкам).",
    ],
    [
      "Клики GSC меньше, чем в интерфейсе",
      r.gsc.connected
        ? `В интерфейсе GSC за период: ${r.gsc.totalClicks} кликов, ${r.gsc.totalImpressions} показов. По запросам: ${r.google.totals.clicks} кликов, ${r.google.totals.impressions} показов. Разница — анонимизированные (редкие) запросы, Google их не отдаёт. На листе «Google — страницы» клики и показы взяты по страницам целиком (${r.pages.totals.clicks} кликов, с анонимизированными запросами; немного расходятся с итогом, потому что Google по-разному агрегирует по ресурсу и по страницам), а клики по известным запросам — отдельной колонкой.`
        : "—",
    ],
    [
      "Клики GSC ≠ визиты Метрики",
      "Клик в выдаче и визит — разные события: часть посетителей блокирует счётчик, уходит до загрузки страницы, Метрика отсекает роботов, а GSC считает клики по своим правилам. Сравнивайте тенденции, а не точные числа.",
    ],
    [
      "Нормализация URL",
      "Протокол и www убраны, UTM и прочие параметры, #якорь удалены, завершающий слэш убран (корень — «wesetup.ru/»), URL-кодировка раскодирована. Если в Метрике у одной страницы несколько адресов (например, с UTM), визиты сложены, а доли и средние пересчитаны по визитам; посетители в этом случае сложены приблизительно.",
    ],
    [
      "Яндекс — фразы",
      `Отчёт Метрики «Поисковые фразы»: группировка ym:s:lastsignSearchPhrase + ym:s:lastsignSearchEngine, фильтр ym:s:lastsignSearchEngineRoot=='yandex'. Визитов с известной фразой: ${r.yandex.totals.visits} из ${r.yandex.visitsAll} из Яндекса — у остальных фраза не определена, как и в интерфейсе.`,
    ],
    [
      "Цели",
      `«Достижения целей» и «Конверсия» — по любой цели счётчика (как в интерфейсе по умолчанию). Отдельные колонки по целям: ${goalList || "нет"}.`,
    ],
    ["Время на сайте", "Формат мм:сс (минуты могут быть больше 59)."],
  ];
}

/** Вчера — сегодняшние данные неполные; по умолчанию 90 дней до вчера включительно. */
export function defaultPeriod(days = 90, now = new Date()): { from: string; to: string } {
  const to = new Date(now.getTime() - 86_400_000);
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

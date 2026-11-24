/**
 * Выгрузка поисковых запросов Google в формате, похожем на отчёт Метрики
 * «Источники → Поисковые фразы».
 *
 * Google не передаёт фразы в Метрику (not provided), поэтому запросы берём из
 * Search Console (запрос → страница), а поведение — из Метрики по странице входа
 * для визитов из Google, и склеиваем по нормализованному URL.
 *
 *   npm run seo:export -- --from 2026-08-25 --to 2026-11-24
 *   npm run seo:export                       # последние 90 дней
 *   npm run seo:export -- --skip-gsc         # без Search Console (только Метрика)
 *
 * Переменные окружения (.env, см. .env.example):
 *   GSC_SERVICE_ACCOUNT_KEY  путь к JSON-ключу сервисного аккаунта Google
 *   GSC_SITE_URL             ресурс Search Console: https://wesetup.ru/ или sc-domain:wesetup.ru
 *   METRIKA_TOKEN            OAuth-токен Яндекса с правом metrika:read
 *   METRIKA_COUNTER_ID       номер счётчика
 *   METRIKA_GOAL_IDS         через запятую; пусто — все активные цели счётчика
 */
import { createSign } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import ExcelJS from "exceljs";

loadEnv({ quiet: true });

// ---------- аргументы ----------

type Args = { from: string; to: string; out?: string; skipGsc: boolean };

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    return eq?.slice(name.length + 3);
  };
  const today = new Date();
  const defTo = new Date(today.getTime() - 86_400_000); // вчера: сегодняшние данные неполные
  const defFrom = new Date(defTo.getTime() - 89 * 86_400_000);
  const from = get("from") ?? isoDate(defFrom);
  const to = get("to") ?? isoDate(defTo);
  for (const [k, v] of [["from", from], ["to", to]] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`--${k} должен быть в формате ГГГГ-ММ-ДД, получено: ${v}`);
  }
  if (from > to) throw new Error(`--from (${from}) позже --to (${to})`);
  return { from, to, out: get("out"), skipGsc: argv.includes("--skip-gsc") };
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
    const res = await fetch(url, init);
    const text = await res.text();
    if (res.ok) return JSON.parse(text) as T;
    const retriable = res.status === 429 || res.status >= 500;
    if (retriable && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    throw new Error(`${what}: HTTP ${res.status} ${text.slice(0, 600)}`);
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

async function loadGsc(keyPath: string, siteUrl: string, from: string, to: string) {
  const token = await googleAccessToken(keyPath);
  const base = { startDate: from, endDate: to, type: "web" };
  const rows: GscRow[] = [];
  const rowLimit = 25_000;
  for (let startRow = 0; ; startRow += rowLimit) {
    const page = await gscQuery(token, siteUrl, { ...base, dimensions: ["query", "page"], rowLimit, startRow });
    rows.push(...page);
    console.log(`  GSC: строки ${startRow + 1}…${startRow + page.length}`);
    if (page.length < rowLimit) break;
  }
  // По страницам без запроса: сюда входят и анонимизированные запросы, поэтому клики по странице полные.
  const pageRows: GscRow[] = [];
  for (let startRow = 0; ; startRow += rowLimit) {
    const page = await gscQuery(token, siteUrl, { ...base, dimensions: ["page"], rowLimit, startRow });
    pageRows.push(...page);
    if (page.length < rowLimit) break;
  }
  // Итог без измерений — совпадает с графиком в интерфейсе GSC (с анонимизированными запросами).
  const [total] = await gscQuery(token, siteUrl, { ...base });
  // За какие дни в GSC реально есть данные: ресурс мог появиться позже начала периода,
  // а последние 2–3 дня Google ещё не обработал.
  const days = (await gscQuery(token, siteUrl, { ...base, dimensions: ["date"], rowLimit })).map((r) => r.keys![0]).sort();
  return {
    rows,
    pageRows,
    total: total ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    firstDay: days[0] ?? null,
    lastDay: days.at(-1) ?? null,
  };
}

// ---------- Яндекс Метрика ----------

type Goal = { id: number; name: string; status?: string };

const BASE_METRICS = [
  "ym:s:visits",
  "ym:s:users",
  "ym:s:bounceRate",
  "ym:s:pageDepth",
  "ym:s:avgVisitDurationSeconds",
  "ym:s:sumGoalReachesAny",
  "ym:s:anyGoalConversionRate",
] as const;

type MetrikaRow = { dims: string[]; m: Record<string, number> };
type MetrikaResult = { rows: MetrikaRow[]; totals: Record<string, number> };

class Metrika {
  constructor(
    private token: string,
    private counterId: string,
    private from: string,
    private to: string,
  ) {}

  private get headers() {
    return { authorization: `OAuth ${this.token}` };
  }

  async goals(ids: number[]): Promise<Goal[]> {
    const json = await fetchJson<{ goals: Goal[] }>(
      `https://api-metrika.yandex.net/management/v1/counter/${this.counterId}/goals`,
      { headers: this.headers },
      "Метрика: цели",
    );
    const all = json.goals.filter((g) => !g.status || g.status === "Active");
    if (!ids.length) return all;
    return ids.map((id) => all.find((g) => g.id === id) ?? { id, name: `Цель ${id}` });
  }

  /** Все строки отчёта; метрики делятся на пачки по 20 (лимит API), строки — по offset/limit. */
  async report(dimensions: string[], metrics: string[], filters: string): Promise<MetrikaResult> {
    const byKey = new Map<string, MetrikaRow>();
    const totals: Record<string, number> = {};
    for (let i = 0; i < metrics.length; i += 20) {
      const chunk = metrics.slice(i, i + 20);
      const limit = 100_000;
      for (let offset = 1; ; offset += limit) {
        const qs = new URLSearchParams({
          ids: this.counterId,
          date1: this.from,
          date2: this.to,
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

// ---------- агрегирование ----------

/** Поведение по странице: суммы и средневзвешенные по визитам (как считает Метрика). */
type Behavior = {
  visits: number;
  users: number;
  bounceRate: number; // доля 0..1
  pageDepth: number;
  duration: number; // секунды
  reaches: number;
  conversion: number; // доля 0..1
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
function mergeBehavior(a: Behavior, b: Behavior): Behavior {
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

// ---------- Excel ----------

type Col = { header: string; key: string; width: number; fmt?: string };

const FMT = {
  int: "#,##0",
  pct: "0.00%",
  pos: "0.0",
  depth: "0.00",
  time: "[mm]:ss",
};

const secondsToExcel = (s: number) => s / 86_400;

function behaviorCols(goals: Goal[], prefix = ""): Col[] {
  return [
    { header: `Визиты${prefix}`, key: "visits", width: 11, fmt: FMT.int },
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

function behaviorValues(b: Behavior | undefined, goals: Goal[]): Record<string, number | null> {
  if (!b) return {};
  const out: Record<string, number | null> = {
    visits: b.visits,
    users: b.users,
    bounceRate: b.bounceRate,
    pageDepth: b.pageDepth,
    duration: secondsToExcel(b.duration),
    reaches: b.reaches,
    conversion: b.conversion,
  };
  for (const g of goals) {
    out[`g${g.id}r`] = b.goals[g.id]?.reaches ?? 0;
    out[`g${g.id}c`] = b.goals[g.id]?.conversion ?? 0;
  }
  return out;
}

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
  return ws;
}

// ---------- main ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const metrikaToken = process.env.METRIKA_TOKEN?.trim();
  const counterId = process.env.METRIKA_COUNTER_ID?.trim();
  const keyPath = process.env.GSC_SERVICE_ACCOUNT_KEY?.trim();
  const siteUrl = process.env.GSC_SITE_URL?.trim() || "https://wesetup.ru/";
  const goalIds = (process.env.METRIKA_GOAL_IDS ?? "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);

  const missing: string[] = [];
  if (!metrikaToken) missing.push("METRIKA_TOKEN");
  if (!counterId) missing.push("METRIKA_COUNTER_ID");
  if (!args.skipGsc && !keyPath) missing.push("GSC_SERVICE_ACCOUNT_KEY (или запустите с --skip-gsc)");
  if (missing.length) {
    console.error(`Не заданы в .env: ${missing.join(", ")}. Образец — .env.example.`);
    process.exit(2);
  }

  console.log(`Период: ${args.from} — ${args.to}`);
  const metrika = new Metrika(metrikaToken!, counterId!, args.from, args.to);
  const goals = await metrika.goals(goalIds);
  console.log(`Цели Метрики (${goals.length}): ${goals.map((g) => g.name).join("; ")}`);
  const metrics = [...BASE_METRICS, ...goals.flatMap((g) => [`ym:s:goal${g.id}reaches`, `ym:s:goal${g.id}conversionRate`])];

  const GOOGLE = "ym:s:lastsignSearchEngineRoot=='google'";
  const YANDEX = "ym:s:lastsignSearchEngineRoot=='yandex'";

  console.log("Метрика: Google по страницам входа…");
  const gPages = await metrika.report(["ym:s:startURL"], metrics, GOOGLE);
  console.log("Метрика: Яндекс по поисковым фразам…");
  const yPhrases = await metrika.report(["ym:s:lastsignSearchPhrase", "ym:s:lastsignSearchEngine"], metrics, YANDEX);
  const yTotalAll = await metrika.report([], ["ym:s:visits"], YANDEX);

  const behaviorByPage = new Map<string, Behavior>();
  for (const r of gPages.rows) {
    const key = normalizeUrl(r.dims[0]);
    const b = behaviorFrom(r.m, goals);
    const prev = behaviorByPage.get(key);
    behaviorByPage.set(key, prev ? mergeBehavior(prev, b) : b);
  }
  const googleTotals = behaviorFrom(gPages.totals, goals);

  let gsc: Awaited<ReturnType<typeof loadGsc>> | null = null;
  let gscRangeNote = "";
  let metrikaInGscRange: number | null = null;
  if (!args.skipGsc) {
    console.log(`Search Console: ${siteUrl}…`);
    gsc = await loadGsc(keyPath!, siteUrl, args.from, args.to);
    if (gsc.firstDay && gsc.lastDay && (gsc.firstDay > args.from || gsc.lastDay < args.to)) {
      const m2 = new Metrika(metrikaToken!, counterId!, gsc.firstDay, gsc.lastDay);
      metrikaInGscRange = (await m2.report([], ["ym:s:visits"], GOOGLE)).totals["ym:s:visits"] ?? 0;
      gscRangeNote =
        `В Search Console есть данные только за ${gsc.firstDay} — ${gsc.lastDay} (запрошено ${args.from} — ${args.to}): ` +
        `ресурс добавлен позже начала периода и/или Google ещё не обработал последние дни. Метрика в выгрузке — за весь запрошенный период ` +
        `(визитов из Google ${googleTotals.visits}); за те же дни, что и GSC, визитов из Google ${metrikaInGscRange}.`;
      console.warn(`\n⚠ ${gscRangeNote}\n`);
    }
  }

  // ----- лист «Google — запросы» -----
  const wb = new ExcelJS.Workbook();
  wb.creator = "WeSetup seo-queries-export";
  wb.created = new Date();

  const gscCols: Col[] = [
    { header: "Клики (GSC)", key: "clicks", width: 10, fmt: FMT.int },
    { header: "Показы", key: "impressions", width: 11, fmt: FMT.int },
    { header: "CTR", key: "ctr", width: 9, fmt: FMT.pct },
    { header: "Средняя позиция", key: "position", width: 10, fmt: FMT.pos },
  ];
  const gscRows = (gsc?.rows ?? [])
    .map((r) => ({ query: r.keys![0], page: r.keys![1], norm: normalizeUrl(r.keys![1]), ...r }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.position - b.position);

  const sumClicks = gscRows.reduce((s, r) => s + r.clicks, 0);
  const sumImpr = gscRows.reduce((s, r) => s + r.impressions, 0);
  const avgPos = sumImpr ? gscRows.reduce((s, r) => s + r.position * r.impressions, 0) / sumImpr : 0;

  addSheet(
    wb,
    "Google — запросы",
    [
      { header: "Поисковая фраза", key: "query", width: 46 },
      { header: "Страница входа", key: "page", width: 34 },
      ...gscCols,
      ...behaviorCols(goals, " (Метрика, по странице)"),
    ],
    {
      query: "Итого и средние",
      page: gsc ? `${gscRows.length} пар «запрос — страница»` : "Search Console не подключена",
      clicks: sumClicks,
      impressions: sumImpr,
      ctr: sumImpr ? sumClicks / sumImpr : 0,
      position: avgPos,
      ...behaviorValues(googleTotals, goals),
    },
    gscRows.map((r) => ({
      query: r.query,
      page: r.norm,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
      ...behaviorValues(behaviorByPage.get(r.norm), goals),
    })),
  );

  // ----- лист «Google — страницы» -----
  // Клики и показы страницы — из GSC по измерению page (полные, с анонимизированными запросами);
  // запросы и «клики по известным запросам» — из пар query+page.
  type PageAgg = { clicks: number; impressions: number; posW: number };
  const pages = new Map<string, PageAgg>();
  for (const r of gsc?.pageRows ?? []) {
    const key = normalizeUrl(r.keys![0]);
    const p = pages.get(key) ?? { clicks: 0, impressions: 0, posW: 0 };
    p.clicks += r.clicks;
    p.impressions += r.impressions;
    p.posW += r.position * r.impressions;
    pages.set(key, p);
  }
  const pageQueries = new Map<string, { q: string; clicks: number; impressions: number }[]>();
  for (const r of gscRows) {
    const list = pageQueries.get(r.norm) ?? [];
    list.push({ q: r.query, clicks: r.clicks, impressions: r.impressions });
    pageQueries.set(r.norm, list);
  }
  const pTotClicks = [...pages.values()].reduce((s, p) => s + p.clicks, 0);
  const pTotImpr = [...pages.values()].reduce((s, p) => s + p.impressions, 0);
  const pTotPos = pTotImpr ? [...pages.values()].reduce((s, p) => s + p.posW, 0) / pTotImpr : 0;
  const allPages = new Set([...pages.keys(), ...pageQueries.keys(), ...behaviorByPage.keys()]);
  const pageRows = [...allPages]
    .map((page) => {
      const p = pages.get(page);
      const qs = pageQueries.get(page) ?? [];
      const b = behaviorByPage.get(page);
      const top = [...qs]
        .sort((a, b2) => b2.clicks - a.clicks || b2.impressions - a.impressions)
        .slice(0, 5)
        .map((q) => q.q)
        .join(", ");
      return {
        page,
        clicks: p?.clicks ?? 0,
        impressions: p?.impressions ?? 0,
        ctr: p?.impressions ? p.clicks / p.impressions : 0,
        position: p?.impressions ? p.posW / p.impressions : null,
        knownClicks: qs.reduce((s, q) => s + q.clicks, 0),
        queriesCount: qs.length,
        ...behaviorValues(b, goals),
        top,
        _visits: b?.visits ?? 0,
      };
    })
    .sort((a, b) => b.clicks - a.clicks || b._visits - a._visits || b.impressions - a.impressions)
    .map(({ _visits, ...rest }) => rest);

  addSheet(
    wb,
    "Google — страницы",
    [
      { header: "Страница входа", key: "page", width: 40 },
      ...gscCols,
      { header: "Клики по известным запросам", key: "knownClicks", width: 12, fmt: FMT.int },
      { header: "Запросов (GSC)", key: "queriesCount", width: 10, fmt: FMT.int },
      ...behaviorCols(goals, " (Метрика)"),
      { header: "Топ-5 запросов", key: "top", width: 80 },
    ],
    {
      page: "Итого и средние",
      clicks: pTotClicks,
      impressions: pTotImpr,
      ctr: pTotImpr ? pTotClicks / pTotImpr : 0,
      position: pTotPos,
      knownClicks: sumClicks,
      queriesCount: gscRows.length,
      ...behaviorValues(googleTotals, goals),
      top: "",
    },
    pageRows,
  );

  // ----- лист «Яндекс — фразы» -----
  const yandexTotals = behaviorFrom(yPhrases.totals, goals);
  addSheet(
    wb,
    "Яндекс — фразы",
    [
      { header: "Поисковая фраза", key: "phrase", width: 50 },
      { header: "Поисковая система", key: "engine", width: 22 },
      ...behaviorCols(goals),
    ],
    { phrase: "Итого и средние", engine: "", ...behaviorValues(yandexTotals, goals) },
    yPhrases.rows
      .map((r) => ({ phrase: r.dims[0], engine: r.dims[1], b: behaviorFrom(r.m, goals) }))
      .sort((a, b) => b.b.visits - a.b.visits || a.phrase.localeCompare(b.phrase, "ru"))
      .map((r) => ({ phrase: r.phrase, engine: r.engine, ...behaviorValues(r.b, goals) })),
  );

  // ----- лист «Пояснения» -----
  const notes = wb.addWorksheet("Пояснения");
  notes.columns = [{ width: 34 }, { width: 110 }];
  const goalList = goals.map((g) => `${g.name} (${g.id})`).join("; ");
  const yandexWithPhrase = yandexTotals.visits;
  const yandexAll = yTotalAll.totals["ym:s:visits"] ?? 0;
  const lines: [string, string][] = [
    ["Период", `${args.from} — ${args.to}`],
    ...(gscRangeNote ? [["Данные Search Console", gscRangeNote] as [string, string]] : []),
    ["Сформировано", new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) + " (МСК)"],
    ["Источник запросов Google", gsc ? `Google Search Console, ресурс ${siteUrl}, searchanalytics.query, измерения query+page, тип web` : "Search Console не подключена (запуск с --skip-gsc)"],
    ["Источник поведения", `Яндекс Метрика, счётчик ${counterId}, Reporting API, accuracy=full, атрибуция «последний значимый переход» (ym:s:lastsign…)`],
    ["Почему так", "Google не передаёт поисковую фразу сайту (not provided), поэтому в Метрике фраз из Google нет. Фразы и клики берём из Search Console, а поведение — из Метрики по странице входа для визитов из Google, и склеиваем по URL."],
    ["Важно", "Визиты, посетители, отказы, глубина, время и цели в листе «Google — запросы» относятся к СТРАНИЦЕ ВХОДА, а не к конкретной фразе. Если на страницу ведут несколько запросов, у всех этих строк одинаковые поведенческие цифры: визиты между запросами не делятся, и складывать их по строкам нельзя."],
    ["Строка «Итого и средние»", "Клики и показы — сумма по строкам, CTR = клики / показы, позиция — средневзвешенная по показам. Поведенческие итоги — общие цифры Метрики по всем визитам из Google за период (а не сумма по строкам)."],
    ["Клики GSC меньше, чем в интерфейсе", gsc ? `В интерфейсе GSC за период: ${gsc.total.clicks} кликов, ${gsc.total.impressions} показов. В выгрузке по запросам: ${sumClicks} кликов, ${sumImpr} показов. Разница — анонимизированные (редкие) запросы, Google их не отдаёт. На листе «Google — страницы» клики и показы взяты по страницам целиком (${pTotClicks} кликов, с анонимизированными запросами; немного расходятся с итогом, потому что Google по-разному агрегирует по ресурсу и по страницам), а клики по известным запросам — отдельной колонкой.` : "—"],
    ["Клики GSC ≠ визиты Метрики", "Клик в выдаче и визит — разные события: часть посетителей блокирует счётчик, уходит до загрузки страницы, Метрика отсекает роботов, а GSC считает клики по своим правилам. Сравнивайте тенденции, а не точные числа."],
    ["Нормализация URL", "Протокол и www убраны, UTM и прочие параметры, #якорь удалены, завершающий слэш убран (корень — «wesetup.ru/»), URL-кодировка раскодирована. Если в Метрике у одной страницы несколько адресов (например, с UTM), визиты сложены, а доли и средние пересчитаны по визитам; посетители в этом случае сложены приблизительно."],
    ["Яндекс — фразы", `Отчёт Метрики «Поисковые фразы»: группировка ym:s:lastsignSearchPhrase + ym:s:lastsignSearchEngine, фильтр ym:s:lastsignSearchEngineRoot=='yandex'. Визитов с известной фразой: ${yandexWithPhrase} из ${yandexAll} из Яндекса — у остальных фраза не определена, как и в интерфейсе.`],
    ["Цели", `«Достижения целей» и «Конверсия» — по любой цели счётчика (как в интерфейсе по умолчанию). Отдельные колонки по целям: ${goalList || "нет"}.`],
    ["Время на сайте", "Формат мм:сс (минуты могут быть больше 59)."],
  ];
  for (const [k, v] of lines) {
    const row = notes.addRow([k, v]);
    row.getCell(1).font = { bold: true };
    row.alignment = { vertical: "top", wrapText: true };
  }

  const out = args.out ?? path.join("exports", `seo-queries-${args.from}-${args.to}.xlsx`);
  mkdirSync(path.dirname(out), { recursive: true });
  await wb.xlsx.writeFile(out);

  console.log("\nСверка:");
  if (gsc) {
    console.log(`  GSC, интерфейс (без измерений): клики ${gsc.total.clicks}, показы ${gsc.total.impressions}`);
    console.log(`  GSC, по страницам:              клики ${pTotClicks}, показы ${pTotImpr}, страниц ${pages.size}`);
    console.log(`  GSC, по запросам и страницам:   клики ${sumClicks}, показы ${sumImpr}, строк ${gscRows.length}`);
    console.log(`  GSC, дни с данными:             ${gsc.firstDay ?? "—"} — ${gsc.lastDay ?? "—"}`);
    if (metrikaInGscRange !== null) console.log(`  Метрика, визиты из Google за дни GSC: ${metrikaInGscRange}`);
  }
  console.log(`  Метрика, визиты из Google:  ${googleTotals.visits} (страниц входа ${behaviorByPage.size})`);
  console.log(`  Метрика, визиты из Яндекса: ${yandexAll}, из них с фразой ${yandexWithPhrase} (${yPhrases.rows.length} строк)`);
  console.log(`\nГотово: ${path.resolve(out)}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith("seo-queries-export.ts");
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

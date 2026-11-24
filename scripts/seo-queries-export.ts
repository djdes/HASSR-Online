/**
 * Выгрузка поисковых запросов Google и Яндекса в Excel (формат отчёта Метрики
 * «Поисковые фразы»). Логика — в src/lib/seo/search-queries.server.ts, её же
 * показывает вкладка /root/seo/queries.
 *
 *   npm run seo:export -- --from 2026-08-25 --to 2026-11-24
 *   npm run seo:export                          # последние 90 дней до вчера
 *   npm run seo:export -- --metrika-range gsc   # поведение Google из Метрики только за дни, где есть данные GSC
 *   npm run seo:export -- --skip-gsc            # без Search Console (только Метрика)
 *   npm run seo:export -- --out D:/report.xlsx
 *
 * Переменные окружения — см. .env.example (METRIKA_*, GSC_*).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { config as loadEnv } from "dotenv";

import {
  buildSearchQueriesWorkbook,
  defaultPeriod,
  loadSearchQueriesReport,
  readSearchQueriesConfig,
  type MetrikaRange,
} from "../src/lib/seo/search-queries.server";

loadEnv({ quiet: true });

function parseArgs(argv: string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0) return argv[i + 1];
    return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  };
  const def = defaultPeriod(90);
  const from = get("from") ?? def.from;
  const to = get("to") ?? def.to;
  for (const [k, v] of [["from", from], ["to", to]] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`--${k} должен быть в формате ГГГГ-ММ-ДД, получено: ${v}`);
  }
  if (from > to) throw new Error(`--from (${from}) позже --to (${to})`);
  const range = get("metrika-range") ?? "period";
  if (range !== "period" && range !== "gsc") throw new Error(`--metrika-range: period или gsc, получено: ${range}`);
  return { from, to, out: get("out"), skipGsc: argv.includes("--skip-gsc"), metrikaRange: range as MetrikaRange };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = readSearchQueriesConfig();
  const missing: string[] = [];
  if (!config.metrikaToken) missing.push("METRIKA_TOKEN");
  if (!config.counterId) missing.push("METRIKA_COUNTER_ID");
  if (!args.skipGsc && !config.gscKeyPath) missing.push("GSC_SERVICE_ACCOUNT_KEY (или запустите с --skip-gsc)");
  if (missing.length) {
    console.error(`Не заданы в .env: ${missing.join(", ")}. Образец — .env.example.`);
    process.exit(2);
  }

  console.log(`Период: ${args.from} — ${args.to}`);
  const r = await loadSearchQueriesReport(
    { from: args.from, to: args.to, metrikaRange: args.metrikaRange, skipGsc: args.skipGsc, log: (s) => console.log(s) },
    config,
  );
  for (const w of r.warnings) console.warn(`\n⚠ ${w}`);
  // Без --skip-gsc ошибка Search Console — это ошибка запуска, а не тихий пустой лист.
  if (!args.skipGsc && r.gsc.error) process.exit(1);

  const out = args.out ?? path.join("exports", `seo-queries-${args.from}-${args.to}.xlsx`);
  mkdirSync(path.dirname(out), { recursive: true });
  await buildSearchQueriesWorkbook(r).xlsx.writeFile(out);

  console.log("\nСверка:");
  if (r.gsc.connected) {
    console.log(`  GSC, интерфейс (без измерений): клики ${r.gsc.totalClicks}, показы ${r.gsc.totalImpressions}`);
    console.log(`  GSC, по страницам:              клики ${r.pages.totals.clicks}, показы ${r.pages.totals.impressions}`);
    console.log(`  GSC, по запросам и страницам:   клики ${r.google.totals.clicks}, показы ${r.google.totals.impressions}, строк ${r.google.totals.pairs}`);
    console.log(`  GSC, дни с данными:             ${r.gsc.firstDay ?? "—"} — ${r.gsc.lastDay ?? "—"}`);
  }
  const mg = r.metrikaGoogle;
  console.log(
    `  Метрика, визиты из Google:  ${r.google.totals.behavior.visits} за ${mg.from} — ${mg.to}` +
      (mg.aligned ? ` (за весь период ${mg.visitsFullPeriod})` : ""),
  );
  console.log(`  Метрика, визиты из Яндекса: ${r.yandex.visitsAll}, из них с фразой ${r.yandex.totals.visits} (${r.yandex.rows.length} строк)`);
  console.log(`\nГотово: ${path.resolve(out)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

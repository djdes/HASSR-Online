/**
 * Сборка каталогов дополнительных языков (tg, hy, ky, de, fr).
 *
 * Источник правды для перевода — `src/i18n/messages/translated/<locale>.json`
 * (и `translated/pricing/<locale>.json`): только уже переведённые строки.
 * Скрипт чистит эти файлы (ключи и порядок как в ru, только строки с теми же
 * аргументами ICU). Полный каталог в репозиторий не кладётся: недостающее
 * подставляет загрузчик (src/i18n/messages.ts) из языка-подстраховки
 * (`FALLBACK_LOCALE`: ru для tg/hy/ky, en для de/fr). Исключение — крошечные
 * pricing-каталоги, они импортируются статически и собираются целиком.
 *
 *   npx tsx scripts/i18n-seed-locales.ts            — пересобрать каталоги
 *   npx tsx scripts/i18n-seed-locales.ts --check    — проверить, что не устарели
 *   npx tsx scripts/i18n-seed-locales.ts --ai [--locale de] [--limit 600]
 *       — досеять непереведённые строки через очередь AI-диспетчера
 *         (нужен настроенный диспетчер, как у /api/translations/auto),
 *         дописать их в translated/<locale>.json и пересобрать каталоги.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { flattenMessages, messageArguments } from "../src/i18n/catalog-validation";
import { BASE_LOCALES, FALLBACK_LOCALE, LOCALES, type Locale } from "../src/i18n/locales";

const ROOT = new URL("../src/i18n/messages/", import.meta.url);
export const EXTRA_LOCALES = LOCALES.filter((l) => !(BASE_LOCALES as readonly string[]).includes(l)) as Exclude<Locale, "ru" | "en" | "uz">[];
const FOLDERS = ["", "pricing/"] as const;

type Tree = { [key: string]: string | Tree };
const read = (path: string): Tree => JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));
const readOptional = (path: string): Tree => (existsSync(new URL(path, ROOT)) ? read(path) : {});

function sameArgs(a: string, b: string): boolean {
  try { return JSON.stringify(messageArguments(a)) === JSON.stringify(messageArguments(b)); } catch { return false; }
}

/**
 * Только переведённое: ключи из ru, в порядке ru, с непустым значением и теми же
 * аргументами ICU. Неизвестные и битые строки выбрасываются (и считаются).
 */
function normalize(ru: Tree, translated: Tree, stats: { done: number; total: number; dropped: number }): Tree {
  const out: Tree = {};
  for (const [key, value] of Object.entries(ru)) {
    const t = translated?.[key];
    if (typeof value === "string") {
      stats.total++;
      if (typeof t === "string" && t.trim() && sameArgs(value, t)) { out[key] = t; stats.done++; }
      else if (t !== undefined) stats.dropped++;
    } else {
      const child = normalize(value, (t && typeof t === "object" ? t : {}) as Tree, stats);
      if (Object.keys(child).length) out[key] = child;
    }
  }
  return out;
}

/** Full catalog (only for the tiny pricing catalogs, imported statically). */
function fill(ru: Tree, fallback: Tree, translated: Tree): Tree {
  const out: Tree = {};
  for (const [key, value] of Object.entries(ru)) {
    if (typeof value === "string") {
      const t = translated?.[key];
      out[key] = typeof t === "string" ? t : (typeof fallback?.[key] === "string" ? fallback[key] : value) as string;
    } else out[key] = fill(value, (fallback?.[key] as Tree) ?? {}, (translated?.[key] as Tree) ?? {});
  }
  return out;
}

export function buildCatalogs(check: boolean): string[] {
  const report: string[] = [];
  const stale: string[] = [];
  const write = (path: string, data: Tree) => {
    const content = JSON.stringify(data, null, 2) + "\n";
    const target = new URL(path, ROOT);
    if (check) { if (!existsSync(target) || readFileSync(target, "utf8") !== content) stale.push(path); }
    else { mkdirSync(new URL(".", target), { recursive: true }); writeFileSync(target, content); }
  };
  for (const folder of FOLDERS) {
    const ru = read(`${folder}ru.json`);
    for (const locale of EXTRA_LOCALES) {
      const stats = { done: 0, total: 0, dropped: 0 };
      const translated = normalize(ru, readOptional(`translated/${folder}${locale}.json`), stats);
      write(`translated/${folder}${locale}.json`, translated);
      if (folder === "pricing/") write(`${folder}${locale}.json`, fill(ru, read(`${folder}${FALLBACK_LOCALE[locale]}.json`), translated));
      report.push(`${folder}${locale}: ${stats.done}/${stats.total} переведено (${Math.round((stats.done / stats.total) * 100)}%)` +
        (stats.dropped ? `, отброшено ${stats.dropped} (нет в ru или другие аргументы ICU)` : ""));
    }
  }
  if (stale.length) throw new Error(`Stale locale catalogs: ${stale.join(", ")}. Run npm run i18n:locales`);
  return report;
}

function setPath(tree: Tree, path: string, value: string) {
  const parts = path.split(".");
  let node = tree;
  for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Tree;
  node[parts.at(-1)!] = value;
}

async function seedWithAi(only: string | undefined, limit: number) {
  const { enqueueAndWait } = await import("../src/lib/ai-assistant/pf-client");
  const { buildAutoTranslateJob, parseAutoTranslateReply, AUTO_TRANSLATE_BATCH } = await import("../src/lib/translations/auto-translate");
  for (const folder of FOLDERS) {
    const ru = flattenMessages(read(`${folder}ru.json`));
    for (const locale of EXTRA_LOCALES.filter((l) => !only || l === only)) {
      const file = `translated/${folder}${locale}.json`;
      const translated = readOptional(file);
      const have = flattenMessages(Object.keys(translated).length ? translated : { _: "x" });
      const missing = Object.keys(ru).filter((key) => !have[key]).slice(0, limit);
      for (let i = 0; i < missing.length; i += AUTO_TRANSLATE_BATCH) {
        const source = Object.fromEntries(missing.slice(i, i + AUTO_TRANSLATE_BATCH).map((k) => [k, ru[k]]));
        const result = await enqueueAndWait(buildAutoTranslateJob(locale, source), { deadlineMs: 180_000 });
        if (!result.ok) { console.error(`${locale}: ${result.code} ${result.error}`); if (result.code === "not_configured") return; continue; }
        const { translations } = parseAutoTranslateReply(result.text, source);
        for (const [k, v] of Object.entries(translations)) setPath(translated, k, v);
        mkdirSync(new URL(`translated/${folder}`, ROOT), { recursive: true });
        writeFileSync(new URL(file, ROOT), JSON.stringify(translated, null, 2) + "\n");
        console.log(`${folder}${locale}: +${Object.keys(translations).length} (${i + AUTO_TRANSLATE_BATCH}/${missing.length})`);
      }
    }
  }
}

if (process.argv[1]?.endsWith("i18n-seed-locales.ts")) {
  const args = process.argv.slice(2);
  const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  (async () => {
    if (args.includes("--ai")) await seedWithAi(arg("--locale"), Number(arg("--limit") ?? 100000));
    console.log(buildCatalogs(args.includes("--check")).join("\n"));
  })().catch((error) => { console.error(error); process.exit(1); });
}

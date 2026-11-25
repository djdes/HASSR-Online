/**
 * Сборка каталогов дополнительных языков (tg, hy, ky, de, fr).
 *
 * Источник правды для перевода — `src/i18n/messages/translated/<locale>.json`
 * (и `translated/pricing/<locale>.json`): только уже переведённые строки.
 * Скрипт собирает полный каталог `messages/<locale>.json`: переведённая
 * строка, если её аргументы ICU совпадают с русским исходником, иначе —
 * строка языка-подстраховки (`FALLBACK_LOCALE`: ru для tg/hy/ky, en для de/fr).
 * Так у каждого языка всегда полный набор ключей, а сайт не показывает
 * «сырые» ключи там, где перевода ещё нет.
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

/** Keys and order follow ru; values: translated when valid, else fallback. */
function build(ru: Tree, fallback: Tree, translated: Tree, stats: { done: number; total: number }): Tree {
  const out: Tree = {};
  for (const [key, value] of Object.entries(ru)) {
    if (typeof value === "string") {
      stats.total++;
      const t = translated?.[key];
      if (typeof t === "string" && t.trim() && sameArgs(value, t)) { out[key] = t; stats.done++; }
      else out[key] = (typeof fallback?.[key] === "string" ? fallback[key] : value) as string;
    } else {
      out[key] = build(value, (fallback?.[key] as Tree) ?? {}, (translated?.[key] as Tree) ?? {}, stats);
    }
  }
  return out;
}

export function buildCatalogs(check: boolean): string[] {
  const report: string[] = [];
  const stale: string[] = [];
  for (const folder of FOLDERS) {
    const ru = read(`${folder}ru.json`);
    for (const locale of EXTRA_LOCALES) {
      const stats = { done: 0, total: 0 };
      const full = build(ru, read(`${folder}${FALLBACK_LOCALE[locale]}.json`), readOptional(`translated/${folder}${locale}.json`), stats);
      const content = JSON.stringify(full, null, 2) + "\n";
      const target = new URL(`${folder}${locale}.json`, ROOT);
      if (check) { if (!existsSync(target) || readFileSync(target, "utf8") !== content) stale.push(`${folder}${locale}.json`); }
      else writeFileSync(target, content);
      report.push(`${folder}${locale}: ${stats.done}/${stats.total} переведено (${Math.round((stats.done / stats.total) * 100)}%)`);
    }
  }
  if (stale.length) throw new Error(`Stale locale catalogs: ${stale.join(", ")}. Run npx tsx scripts/i18n-seed-locales.ts`);
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

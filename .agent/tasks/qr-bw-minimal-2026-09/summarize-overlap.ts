/**
 * Сводка `check-qr-overlap.ts` по наборам (полные JSON — вне репозитория, в
 * QR_CHECK_OUT/raw): бланков OK, страниц в шапке / в углу / без QR, максимум
 * «чернил» пробы на месте плитки, пикселей, изменённых штампом вне плитки,
 * расхождений модулей и разницы «вровень».
 *
 *   node --import tsx .agent/tasks/qr-bw-minimal-2026-09/summarize-overlap.ts <папка raw> [метка]
 * Итог — raw/check-overlap-summary[-метка].json.
 */
import fs from "node:fs";
import path from "node:path";

type Page = {
  page: number;
  where: string;
  inkBeforeStamp: number;
  knownOverflow: string | null;
  changedOutside: number;
  moduleMismatches: number;
  alignDiffMm: number | null;
  marginsOk: boolean;
  ok: boolean;
};
type Case = { set: string; label: string; modules: number; pagesPlain: number; pages: number; results: Page[]; ok: boolean };

const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "qr-bw-minimal-2026-09");

function main() {
  const [dir, tag] = process.argv.slice(2);
  const files = fs.readdirSync(dir).filter((f) => /^check-overlap-.*\.json$/.test(f));
  const sets: Record<string, unknown> = {};
  let allOk = true;
  for (const file of files) {
    const cases = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Case[];
    const pages = cases.flatMap((c) => c.results.map((r) => ({ ...r, set: c.set, label: c.label })));
    const set = cases[0]?.set ?? file;
    const ok = cases.filter((c) => c.ok).length;
    if (ok !== cases.length) allOk = false;
    sets[set] = {
      blanksOk: `${ok}/${cases.length}`,
      pages: pages.length,
      header: pages.filter((p) => p.where === "header").length,
      corner: pages.filter((p) => p.where === "corner").length,
      none: pages.filter((p) => p.where === "none").length,
      maxInkBeforeStamp: Math.max(0, ...pages.filter((p) => !p.knownOverflow).map((p) => p.inkBeforeStamp)),
      knownOverflowPages: pages.filter((p) => p.knownOverflow).map((p) => `${p.label} стр. ${p.page}`),
      maxChangedOutside: Math.max(0, ...pages.map((p) => p.changedOutside)),
      maxModuleMismatches: Math.max(0, ...pages.map((p) => p.moduleMismatches)),
      maxAlignDiffMm: Math.max(0, ...pages.map((p) => p.alignDiffMm ?? 0)),
      marginsOk: pages.every((p) => p.marginsOk),
      failedPages: pages.filter((p) => !p.ok).map((p) => `${p.label} стр. ${p.page}`),
    };
  }
  const out = path.join(TASK_DIR, "raw", `check-overlap-summary${tag ? `-${tag}` : ""}.json`);
  fs.writeFileSync(out, JSON.stringify({ ok: allOk, sets }, null, 1));
  console.log(JSON.stringify({ ok: allOk, sets }, null, 1));
}

main();

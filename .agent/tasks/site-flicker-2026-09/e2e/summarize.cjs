// Сводка замеров flicker-probe: таблица «страница → что моргает → сколько мс», и «до → после».
// Запуск: node summarize.cjs <до> [<после>] > summary.md
//   <до>/<после> — метка прогона (d:/wt/tmp-flicker/<метка>/results.json) или путь к results.json,
//   например ../raw/before-results.json (замер «до» из этой задачи).
const fs = require("node:fs");
const path = require("node:path");

const [a, b] = process.argv.slice(2);
const load = (x) =>
  JSON.parse(fs.readFileSync(x.endsWith(".json") ? x : path.join("d:/wt/tmp-flicker", x, "results.json"), "utf8"));
const A = load(a);
const B = b ? load(b) : null;

// Сценарий без конфигурации темы: «load:dashboard», «nav:journals>journal», «wn …».
function scenarioKey(run) {
  if (run.config === "wn" || run.config === "wn-legacy") return `${run.config} · ${run.scenario}`;
  if (run.config.startsWith("mini:")) return `mini · ${run.scenario.replace(/\/journals\/[^/>]+\/documents\/[^/>]+/g, "/doc")}`;
  return run.scenario.replace(/\/journals\/[^/>]+\/documents\/[^/>]+/g, "/doc");
}

function aggregate(res) {
  const map = new Map();
  for (const run of res.runs) {
    const key = scenarioKey(run);
    const g = map.get(key) || { key, runs: 0, wrongMs: 0, wrongFrames: 0, wrongWhere: new Set(), frameWrongMs: 0, wn: new Set(), wnShownAt: [], blankMax: 0, cls: 0, skeletons: new Set(), logout: new Set() };
    g.runs++;
    if (run.wrongTheme) {
      if (run.wrongTheme.ms > 0) g.wrongWhere.add(`${run.viewport}/${run.config}`);
      g.wrongMs = Math.max(g.wrongMs, run.wrongTheme.ms);
      g.wrongFrames = Math.max(g.wrongFrames, run.wrongTheme.frames);
    }
    if (run.frames && run.frames.wrongTheme) g.frameWrongMs = Math.max(g.frameWrongMs, run.frames.wrongTheme.ms);
    if (run.whatsNew) {
      if (run.whatsNew.events.length) g.wn.add(run.whatsNew.events.join(","));
      if (run.whatsNew.shownAtMs !== null) g.wnShownAt.push(run.whatsNew.shownAtMs);
    }
    if (run.loading) {
      g.blankMax = Math.max(g.blankMax, run.loading.blankMaxRunMs || 0);
      for (const s of run.loading.skeletons || []) g.skeletons.add(s.sk.replace(/^Загружаем /, "").replace(/…/, ""));
    }
    if (run.cls) g.cls = Math.max(g.cls, run.cls.all);
    if (run.sequence) g.logout.add(run.sequence.map((x) => `${x.cls}+${x.ms}`).join(" → "));
    map.set(key, g);
  }
  return map;
}

function fmtTheme(g) {
  if (!g) return "—";
  if (!g.wrongMs && !g.frameWrongMs) return "0";
  return `${g.wrongMs} мс (${g.wrongFrames} кадр.)${g.frameWrongMs ? `, по кадрам ${g.frameWrongMs} мс` : ""}`;
}
function fmtWn(g) {
  if (!g || (!g.wn.size && !g.wnShownAt.length)) return "—";
  const at = g.wnShownAt.length ? `видно с ${Math.min(...g.wnShownAt)}–${Math.max(...g.wnShownAt)} мс` : "";
  const ev = g.wn.size ? [...g.wn].join("; ") : "";
  return [at, ev && `события: ${ev}`].filter(Boolean).join(", ");
}

const ma = aggregate(A);
const mb = B ? aggregate(B) : null;
const keys = [...new Set([...ma.keys(), ...(mb ? mb.keys() : [])])];

const out = [];
const nm = (x) => (x.endsWith(".json") ? path.basename(x, ".json") : x);
out.push(`## Замер «${nm(a)}»${B ? ` → «${nm(b)}»` : ""}`);
out.push("");
out.push(`Окно разбора: ${A.window} мс после начала перехода. Прогонов: ${A.runs.length}${B ? ` / ${B.runs.length}` : ""}.`);
out.push("");
if (!B) {
  out.push("| Сценарий | Чужая тема (макс) | Где | «Что нового» | Пусто без скелетона, макс | CLS макс | Скелетоны |");
  out.push("|---|---|---|---|---|---|---|");
  for (const k of keys) {
    const g = ma.get(k);
    out.push(`| ${k} | ${fmtTheme(g)} | ${[...g.wrongWhere].slice(0, 4).join(", ") || "—"} | ${fmtWn(g)} | ${g.blankMax} мс | ${g.cls} | ${[...g.skeletons].join(" › ") || (g.logout.size ? [...g.logout].join(" / ") : "—")} |`);
  }
} else {
  out.push("| Сценарий | Чужая тема: до → после | «Что нового»: до → после | Пусто без скелетона: до → после | CLS: до → после | Скелетоны: до → после |");
  out.push("|---|---|---|---|---|---|");
  for (const k of keys) {
    const x = ma.get(k);
    const y = mb.get(k);
    const sk = (g) => (g ? [...g.skeletons].join(" › ") || (g.logout.size ? [...g.logout].join(" / ") : "—") : "—");
    out.push(`| ${k} | ${fmtTheme(x)} → ${fmtTheme(y)} | ${fmtWn(x)} → ${fmtWn(y)} | ${x ? x.blankMax : "—"} → ${y ? y.blankMax : "—"} мс | ${x ? x.cls : "—"} → ${y ? y.cls : "—"} | ${sk(x)} → ${sk(y)} |`);
  }
}
out.push("");
const errs = (res) => res.errors.map((e) => `- ${e.vp || ""} ${e.cfg || e.id || ""}: ${String(e.error).split("\n")[0]}`);
if (A.errors.length || (B && B.errors.length)) {
  out.push("Ошибки прогона:");
  out.push(...errs(A));
  if (B) out.push(...errs(B));
}
console.log(out.join("\n"));

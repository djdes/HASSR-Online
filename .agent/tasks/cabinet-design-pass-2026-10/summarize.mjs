// Сводка метрик «до/после» по критериям приёмки: node summarize.mjs [before|after]
// Читает raw/<tag>/metrics-*.json (shots.mjs) и raw/after/points-*.json (points-shots.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TAG = process.argv[2] || "after";
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "raw", TAG);
const roles = {};
for (const file of fs.readdirSync(DIR).filter((f) => /^metrics-.*\.json$/.test(f))) {
  Object.assign(roles, JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")).roles);
}
const lines = [];
const fail = [];
const say = (text) => lines.push(text);
const check = (ok, text) => {
  say(`${ok ? "PASS" : "FAIL"}  ${text}`);
  if (!ok) fail.push(text);
};
const ENTRY = [
  "/dashboard",
  "/production-control",
  "/settings/users",
  "/settings/buildings",
  "/journals",
  "/settings/sections/journals",
  "/checklists",
  "/settings/subscription",
  "/more",
  "/inspection",
];

for (const [role, data] of Object.entries(roles)) {
  say(`\n== ${role}`);
  // AC1 — стрелки в главном меню сайдбара (на «Остальном», без открытого раздела).
  const side = data["desktop more-sidebar"] ?? data["desktop main-menu"];
  if (side?.sections?.length) {
    const wrong = side.sections.filter((s) => (s.key === "more" ? s.chevron : !s.chevron));
    check(wrong.length === 0, `AC1 сайдбар: стрелка у ${side.sections.filter((s) => s.chevron).map((s) => s.key).join(",")}; без стрелки: ${side.sections.filter((s) => !s.chevron).map((s) => s.key).join(",")}`);
    const pc = side.sections.find((s) => s.key === "productionControl");
    if (pc) say(`      «Производственный контроль»: строк ≈ ${pc.lines}`);
    // AC3 — «Пришла проверка» в покое.
    const insp = side.sections.find((s) => s.key === "inspection");
    // Состояния «Пришла проверка» меряет ac3-shots.mjs (курсор уведён), здесь он мог остаться над кнопкой.
    if (insp) say(`      «Пришла проверка» на «Остальном» (возможно, под курсором): фон ${insp.bg}, рамка ${insp.border}`);
  }
  const inspPage = data["desktop main-menu"]?.sections?.find((s) => s.key === "inspection" && s.current);
  if (inspPage) say(`      «Пришла проверка» открыта: фон ${inspPage.bg}, рамка ${inspPage.border}`);
  for (const key of Object.keys(data).filter((k) => / main-menu$/.test(k) && !k.startsWith("desktop"))) {
    const rows = data[key];
    if (!Array.isArray(rows) || !rows.length) continue;
    const wrong = rows.filter((s) => (s.key === "more" ? s.chevron : !s.chevron));
    check(wrong.length === 0, `AC1 ${key}: стрелки ${rows.filter((s) => s.chevron).length}/${rows.length}, без стрелки: ${rows.filter((s) => !s.chevron).map((s) => s.key).join(",") || "—"}`);
  }
  const sections = data["mini /mini/sections"];
  if (sections?.length) {
    const wrong = sections.filter((s) => (s.href === "/more" ? s.chevron : !s.chevron));
    check(wrong.length === 0, `AC1 /mini/sections: без стрелки — ${sections.filter((s) => !s.chevron).map((s) => s.label).join(", ") || "—"}`);
  }
  for (const key of ["mobile drill staff", "mini drill staff"]) {
    const drill = data[key];
    if (!drill) continue;
    check(drill.mode === "section" && drill.section === "staff" && (!drill.urlBefore || drill.urlBefore === drill.urlAfter), `AC1 ${key}: режим ${drill.mode}/${drill.section}, адрес ${drill.urlBefore ?? ""}→${drill.urlAfter}, пунктов ${drill.items?.length}`);
  }
  // AC2, AC4, AC5 — по страницам.
  for (const [key, m] of Object.entries(data)) {
    if (!m || typeof m !== "object" || !("h1s" in m)) continue;
    const [view, href] = key.split(" ");
    const company = m.sidebarBrand?.replace(/Добавить логотип/, "").replace(/^\S{1,2}\s/, "").trim();
    if (m.headerCenter !== undefined && view !== "mini") {
      check(!company || !m.headerCenter || m.headerCenter.replace(/^(Точка|Точки)\s*/, "") !== company, `AC2 ${key}: центр шапки «${m.headerCenter ?? "—"}» (${m.headerCenterKind ?? "нет"}), слева «${company ?? "—"}»`);
    }
    if (ENTRY.includes(href) && view === "desktop") {
      check(m.h1s.length === 1 && (m.eyebrows ?? []).length === 0 && m.companyInMain !== true, `AC4 ${key}: h1=${JSON.stringify(m.h1s)} надстрочная=${JSON.stringify(m.eyebrows ?? null)} компания в main=${m.companyInMain}`);
    }
    if (view === "desktop") check(m.overflowRight.length === 0 && !m.pageScrollX, `AC5 ${key}: за правым краем ${m.overflowRight.length}${m.overflowRight.length ? " " + JSON.stringify(m.overflowRight) : ""}`);
    if (view !== "desktop") check(!m.pageScrollX, `AC5 ${key}: горизонтальная прокрутка ${m.pageScrollX}`);
  }
  for (const key of Object.keys(data).filter((k) => / menu-button$/.test(k))) say(`      ${key}: «${String(data[key]).replace(/\s+/g, " ")}»`);
}

for (const file of fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /^points-.*\.json$/.test(f)) : []) {
  const p = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
  say(`\n== точки: ${p.case}`);
  for (const view of ["desktop", "mobile"]) {
    const v = p[view];
    if (!v) continue;
    const company = v.company?.replace(/Добавить логотип/, "").replace(/^\S{1,2}\s/, "").trim();
    check(!v.title || v.title !== company, `AC2 ${p.case}/${view}: ${v.kind} «${v.caption ?? ""} / ${v.title ?? v.text ?? "—"}» подсказка «${v.hint ?? ""}»${v.options ? " список " + JSON.stringify(v.options) : ""}`);
  }
}

for (const file of fs.readdirSync(DIR).filter((f) => /^ac3-.*\.json$/.test(f))) {
  const s = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
  say(`\n== «Пришла проверка»: ${s.email}`);
  const outline = (st) => /rgb\(255, 255, 255\)/.test(st.bg) && /^1px/.test(st.border);
  check(outline(s.rest) && s.rest.bg !== s.activeItem.bg, `AC3 сайт, покой: фон ${s.rest.bg}, рамка ${s.rest.border}; у выбранного пункта фон ${s.activeItem.bg}`);
  check(s.hover.bg !== s.rest.bg, `AC3 сайт, наведение: фон ${s.hover.bg}, рамка ${s.hover.border}`);
  check(s.open.current === "page" && s.open.bg === s.activeItem.bg, `AC3 сайт, раздел открыт: фон ${s.open.bg} (как у выбранного пункта)`);
  check(outline(s.mobileRest) && s.mobileRest.bg !== s.mobileActiveItem.bg, `AC3 телефон, лист меню: фон ${s.mobileRest.bg}, рамка ${s.mobileRest.border}; у выбранного ${s.mobileActiveItem.bg}`);
}

say(`\nИтого: ${fail.length ? `FAIL ${fail.length}` : "все проверки PASS"}`);
console.log(lines.join("\n"));
fs.writeFileSync(path.join(DIR, "summary.txt"), lines.join("\n") + "\n");

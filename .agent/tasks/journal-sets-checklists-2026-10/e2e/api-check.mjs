/**
 * Проверка API на локальном dev-сервере (база wesetup_e2e):
 * наборы журналов, типовые шаблоны чек-листов, права.
 *
 *   node .agent/tasks/journal-sets-checklists-2026-10/e2e/api-check.mjs http://localhost:3031
 *
 * Перед запуском — e2e/setup.ts (создаёт организации и пользователей).
 */
import fs from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3031";
const DIR = ".agent/tasks/journal-sets-checklists-2026-10/raw";
const state = JSON.parse(fs.readFileSync(`${DIR}/e2e-state.json`, "utf8"));
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail).slice(0, 300)}`}`);
}

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password: state.password }),
  });
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!res.ok) throw new Error(`login ${email}: ${res.status} ${await res.text()}`);
  return cookies;
}

async function call(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: BASE, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json() : type.includes("pdf") ? { pdfBytes: (await res.arrayBuffer()).byteLength } : await res.text();
  return { status: res.status, data };
}

const manager = await login("js-manager@e2e.local");
const cook = await login("js-cook@e2e.local");

// ── Наборы журналов ────────────────────────────────────────────────────
let r = await call(null, "GET", "/api/settings/journals/sets");
check("наборы: без входа — 401", r.status === 401, r.status);
r = await call(cook, "GET", "/api/settings/journals/sets");
check("наборы: повар — 403", r.status === 403, r.status);
r = await call(cook, "POST", "/api/settings/journals/sets", { set: "standard" });
check("включить набор: повар — 403", r.status === 403, r.status);

r = await call(manager, "GET", "/api/settings/journals/sets");
fs.writeFileSync(`${DIR}/api-sets-get-initial.json`, JSON.stringify(r.data, null, 2));
const byId = (data) => Object.fromEntries(data.sets.map((s) => [s.id, s]));
let sets = byId(r.data);
check("наборы: GET руководителя — 200, три набора", r.status === 200 && r.data.sets.length === 3, r.data.sets?.map((s) => `${s.id}:${s.enabledCount}/${s.total}`));
check("стандартный набор у новой организации-ресторана — 11 из 11", sets.standard.enabledCount === 11 && sets.standard.total === 11, sets.standard.enabledCount);
check("журнал здоровья — связанный пункт, выключен", sets.standard.items[2].related[0]?.code === "health_check" && sets.standard.items[2].related[0]?.enabled === false, sets.standard.items[2]);
check("набор ХАССП — 19 пунктов, включены только 2 общих со стандартным", sets.haccp.total === 19 && sets.haccp.enabledCount === 2, sets.haccp.enabledCount);

r = await call(manager, "POST", "/api/settings/journals/sets", { set: "extra" });
check("«Доп. журналы» целиком не включаются — 400", r.status === 400, r.data);
r = await call(manager, "POST", "/api/settings/journals/sets", { set: "all" });
check("неизвестный набор — 400", r.status === 400, r.data);
r = await call(manager, "POST", "/api/settings/journals/sets", { set: "standard" });
check("стандартный уже включён — повтор ничего не меняет", r.status === 200 && r.data.changed.length === 0, r.data.changed);

r = await call(manager, "POST", "/api/settings/journals/sets", { set: "haccp" });
fs.writeFileSync(`${DIR}/api-sets-enable-haccp.json`, JSON.stringify(r.data, null, 2));
sets = byId(r.data);
check("включить набор ХАССП — 17 журналов включено, 19 из 19", r.status === 200 && r.data.changed.length === 17 && sets.haccp.enabledCount === 19, r.data.changed);
check("ККТ включён набором ХАССП", r.data.changed.includes("ccp_monitoring"));
r = await call(manager, "POST", "/api/settings/journals/sets", { set: "haccp" });
check("повторное включение ХАССП — идемпотентно", r.status === 200 && r.data.changed.length === 0, r.data.changed);

// ── Типовые шаблоны чек-листов ─────────────────────────────────────────
r = await call(null, "GET", "/api/checklists/templates/typical");
check("типовые: без входа — 401", r.status === 401, r.status);
r = await call(manager, "GET", "/api/checklists/templates/typical");
fs.writeFileSync(`${DIR}/api-typical-get-initial.json`, JSON.stringify(r.data, null, 2));
check("типовые: GET — 6 шаблонов, ни один не добавлен", r.status === 200 && r.data.templates.length === 6 && r.data.templates.every((t) => !t.added), r.data.templates?.map((t) => `${t.key}:${t.questions}`));
r = await call(cook, "POST", "/api/checklists/templates/typical", { key: "sanpin" });
check("добавить типовой: повар — 403", r.status === 403, r.status);
r = await call(manager, "POST", "/api/checklists/templates/typical", { key: "nope" });
check("неизвестный ключ — 400", r.status === 400, r.data);

const added = {};
for (const t of ["sanpin", "haccp", "territorial-manager", "chief-technologist", "rospotrebnadzor-prep", "haccp-audit"]) {
  r = await call(manager, "POST", "/api/checklists/templates/typical", { key: t });
  check(`добавить «${t}» — 201`, r.status === 201 && r.data.created === true, r.data.template?.title);
  added[t] = r.data.template?.id;
}
r = await call(manager, "POST", "/api/checklists/templates/typical", { key: "sanpin" });
check("повторное добавление — 200, копия не плодится", r.status === 200 && r.data.created === false && r.data.template.id === added.sanpin, r.data);
r = await call(manager, "GET", "/api/checklists/templates/typical");
check("типовые: после добавления — все отмечены", r.data.templates.every((t) => t.added), r.data.templates.map((t) => t.added));

r = await call(manager, "GET", "/api/checklists/templates");
const own = r.data.templates.filter((t) => Object.values(added).includes(t.id));
check("копии лежат в ChecklistTemplate организации", own.length === 6, own.map((t) => t.title));

for (const [key, id] of Object.entries(added)) {
  r = await call(manager, "GET", `/api/checklists/templates/${id}/pdf`);
  check(`PDF шаблона «${key}»`, r.status === 200 && r.data.pdfBytes > 10_000, r.data);
  r = await call(manager, "POST", "/api/checklists/inspections", { templateId: id });
  check(`проверка по шаблону «${key}» создаётся`, r.status === 201, r.data);
}

fs.writeFileSync(`${DIR}/api-check-results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((x) => !x.ok).length;
console.log(`\nИтого: ${results.length - failed} PASS, ${failed} FAIL`);
process.exitCode = failed ? 1 : 0;

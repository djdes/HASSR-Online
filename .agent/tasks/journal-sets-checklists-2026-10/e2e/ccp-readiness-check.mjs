/**
 * Проверка на локальном dev-сервере (база wesetup_e2e):
 * - журнал «Мониторинг ККТ»: страница, форма, запись через /api/journals,
 *   PDF записей (/api/reports/pdf), образец бланка, страница ППК «ККТ»;
 * - «Готовность»: проверка «Журналы стандартного набора включены» —
 *   все 11 → выключаем 2 → включаем набор обратно.
 *
 *   node .agent/tasks/journal-sets-checklists-2026-10/e2e/ccp-readiness-check.mjs http://localhost:3031
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
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function call(cookie, method, path, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: cookie, Origin: BASE, ...(body ? { "Content-Type": "application/json" } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(600_000),
  });
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("pdf")) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type, pdf: buf };
  }
  return { status: res.status, type, data: type.includes("json") ? await res.json() : await res.text() };
}

/** Текст страницы без тегов — для поиска подписей. */
const plain = (html) => String(html).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");

const manager = await login("js-manager@e2e.local");

// ── Мониторинг ККТ ─────────────────────────────────────────────────────
let r = await call(manager, "GET", "/journals/ccp_monitoring");
check("страница /journals/ccp_monitoring — 200", r.status === 200, r.status);
check("страница журнала с названием из каталога", plain(r.data).includes("мониторинга критических контрольных точек"), null);

r = await call(manager, "GET", "/journals/ccp_monitoring/new");
const formText = plain(r.data);
check("форма /journals/ccp_monitoring/new — 200", r.status === 200, r.status);
for (const label of ["Название ККТ", "Параметр контроля", "Критический предел", "Фактическое значение", "В пределах нормы"]) {
  check(`форма содержит поле «${label}»`, formText.includes(label));
}

const countEntries = (html) => Number(plain(html).match(/(\d+) запис/)?.[1] ?? 0);
const before = countEntries((await call(manager, "GET", "/journals/ccp_monitoring")).data);
const today = new Date().toISOString().slice(0, 10);
r = await call(manager, "POST", "/api/journals", {
  templateCode: "ccp_monitoring",
  data: { ccpName: "ККТ-1 Тепловая обработка", controlParameter: "Температура в толще изделия", criticalLimit: "не ниже +75 °C", actualValue: "81 °C", withinLimit: true },
}, { "Idempotency-Key": `ccp-ok-${Date.now()}` });
check("запись в пределах — создаётся", r.status === 200 || r.status === 201, r.data);
r = await call(manager, "POST", "/api/journals", {
  templateCode: "ccp_monitoring",
  data: { ccpName: "ККТ-1 Тепловая обработка", controlParameter: "Температура в толще изделия", criticalLimit: "не ниже +75 °C", actualValue: "71 °C", withinLimit: false, correctiveAction: "Возврат на дожарку, повторный замер 80 °C" },
}, { "Idempotency-Key": `ccp-dev-${Date.now()}` });
check("запись с отклонением и корректирующим действием — создаётся", r.status === 200 || r.status === 201, r.data);
const deviationId = r.data?.entry?.id;

r = await call(manager, "GET", "/journals/ccp_monitoring");
check("записи появились в списке журнала (+2)", countEntries(r.data) === before + 2, { before, after: countEntries(r.data) });
r = await call(manager, "GET", `/journals/ccp_monitoring/${deviationId}`);
const entryText = plain(r.data);
check("страница записи показывает значения и корректирующее действие", r.status === 200 && ["ККТ-1 Тепловая обработка", "71 °C", "Возврат на дожарку"].every((v) => entryText.includes(v)), r.status);

r = await call(manager, "GET", `/api/reports/pdf?template=ccp_monitoring&from=${today.slice(0, 8)}01&to=${today}`);
check("PDF записей /api/reports/pdf — 200, application/pdf", r.status === 200 && r.pdf?.length > 5000, { status: r.status, bytes: r.pdf?.length, data: r.data });
if (r.pdf) fs.writeFileSync(`${DIR}/ccp-entries-report.pdf`, r.pdf);

r = await call(manager, "GET", "/api/journal-samples/ccp_monitoring/pdf?inline=1");
check("образец бланка /api/journal-samples/ccp_monitoring/pdf — 200", r.status === 200 && r.pdf?.length > 5000, { status: r.status, bytes: r.pdf?.length });

r = await call(manager, "GET", "/production-control/haccp/control-points");
check("страница ППК «ККТ» открывается", r.status === 200, r.status);

// ── «Готовность» ───────────────────────────────────────────────────────
const READINESS = "/dashboard/compliance-audit";
r = await call(manager, "GET", READINESS);
let text = plain(r.data);
check("«Готовность» — 200", r.status === 200, r.status);
check("проверка называется «Журналы стандартного набора включены»", text.includes("Журналы стандартного набора включены"));
check("все 11 включены — так и написано", text.includes("Включены все 11 журналов стандартного набора"), text.match(/Включен[^.]*стандартного набора[^.]*\./)?.[0]);

const sets = await call(manager, "GET", "/api/settings/journals/sets");
const disabledNow = new Set();
for (const set of sets.data.sets) for (const item of set.items) if (!item.enabled) disabledNow.add(item.code);
disabledNow.add("health_check");
r = await call(manager, "PATCH", "/api/settings/journals", { disabledCodes: [...disabledNow, "med_books", "staff_training"] });
check("выключили «Медкнижки» и «Инструктажи» через настройки", r.status === 200, r.status);

r = await call(manager, "GET", READINESS);
text = plain(r.data);
const line = text.match(/Включено \d+ из 11 журналов стандартного набора\. Не включены: [^.]*\./)?.[0];
check("«Готовность»: 9 из 11 и названия выключенных", Boolean(line) && line.includes("9 из 11") && line.includes("«Медицинские книжки»") && line.includes("«Журнал регистрации инструктажей"), line);

r = await call(manager, "POST", "/api/settings/journals/sets", { set: "standard" });
check("«Включить весь набор» вернул ровно два журнала", r.status === 200 && JSON.stringify([...r.data.changed].sort()) === JSON.stringify(["med_books", "staff_training"]), r.data.changed);
r = await call(manager, "GET", READINESS);
check("«Готовность» снова: все 11", plain(r.data).includes("Включены все 11 журналов стандартного набора"));

fs.writeFileSync(`${DIR}/ccp-readiness-results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((x) => !x.ok).length;
console.log(`\nИтого: ${results.length - failed} PASS, ${failed} FAIL`);
process.exitCode = failed ? 1 : 0;

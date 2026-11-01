// Отдельная копия e2e-базы (wesetup_ptinteg, dev на 3020), не прод.
// Сборка всех PR #88–#95: страницы открываются, точка не видит и не меняет чужое,
// «Распределение» журнала пишется только своей организации.
// node .agent/tasks/point-deep-audit-2026-11-01/raw/http-check.mjs
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const dir = ".agent/tasks/point-deep-audit-2026-11-01/raw";
const fx = JSON.parse(readFileSync(`${dir}/fixture.json`, "utf8"));
const base = process.env.BASE_URL ?? "http://localhost:3020";
const out = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
};

async function login(email) {
  const jar = new Map();
  const keep = (res) => {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const at = pair.indexOf("=");
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  keep(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password: fx.password, json: "true" }),
  });
  keep(res);
  if (![...jar.keys()].some((k) => k.includes("session-token"))) throw new Error(`вход не удался: ${email} (${res.status})`);
  return cookie();
}

async function req(method, path, cookie, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

const withPoint = (cookie, pointId) => `${cookie}; wesetup.building=${fx.orgId}:${pointId}`;

// 1. Владелец (вся организация): страницы кабинета открываются без ошибок.
const owner = await login(fx.owner);
const ownerOrg = withPoint(owner, "organization");
const pages = [
  "/dashboard", "/journals", "/journals/points", "/journals/hygiene", "/journals/cold_equipment_control",
  `/journals/hygiene/documents/${fx.hygieneDocA}`, `/journals/hygiene/documents/${fx.hygieneDocB}`,
  "/settings/journals", "/settings/journal-bonuses", "/settings/auto-journals", "/settings/equipment", "/settings/areas",
  "/settings/users", "/settings/kiosk", "/competencies", "/bonuses", "/mercury", "/inspection", "/settings/staff-health",
];
for (const page of pages) {
  const res = await req("GET", page, ownerOrg);
  check(`владелец: ${page} открывается`, res.status === 200, `HTTP ${res.status}`);
}
for (const api of ["/api/mini/home", "/api/search?q=%D0%A8%D0%A5", "/api/journal-task-pool/cold_equipment_control", "/api/equipment", "/api/areas", "/api/journals/today-status"]) {
  const res = await req("GET", api, ownerOrg);
  check(`владелец: ${api} отвечает`, res.status === 200, `HTTP ${res.status}`);
}
{
  const res = await req("GET", "/api/equipment", ownerOrg);
  const names = JSON.stringify(res.json);
  check("владелец (вся организация): в /api/equipment оба холодильника", names.includes(fx.fridgeA) && names.includes(fx.fridgeB));
}
{
  const res = await req("GET", "/api/equipment", withPoint(owner, fx.pointA));
  const names = JSON.stringify(res.json);
  check("владелец смотрит точку А: в /api/equipment только холодильник А", names.includes(fx.fridgeA) && !names.includes(fx.fridgeB));
}

// 2. Повар точки А: документ точки Б не открыть.
const cookA = await login(fx.cookA);
{
  const own = await req("GET", `/api/journal-documents/${fx.hygieneDocA}`, cookA);
  const foreign = await req("GET", `/api/journal-documents/${fx.hygieneDocB}`, cookA);
  check("повар А: свой документ гигиены открывается", own.status === 200, `HTTP ${own.status}`);
  check("повар А: документ гигиены точки Б — не найден", foreign.status === 404, `HTTP ${foreign.status}`);
  // Next.js при потоковой отдаче оставляет 200 и рисует «не найдено» — смотрим на
  // метку notFound() и на то, что названия документа точки Б в странице нет.
  const page = await req("GET", `/journals/hygiene/documents/${fx.hygieneDocB}`, cookA);
  check(
    "повар А: страница документа точки Б — «не найдено», без содержимого",
    page.status === 404 || (page.text.includes("NEXT_HTTP_ERROR_FALLBACK;404") && !page.text.includes("гигиена точки Б")),
    `HTTP ${page.status}`,
  );
  const ownPage = await req("GET", `/journals/hygiene/documents/${fx.hygieneDocA}`, cookA);
  check("повар А: своя страница документа открывается", ownPage.status === 200 && !ownPage.text.includes("NEXT_HTTP_ERROR_FALLBACK;404"), `HTTP ${ownPage.status}`);
  const eq = await req("GET", "/api/equipment", cookA);
  const names = JSON.stringify(eq.json);
  check("повар А: в /api/equipment нет холодильника точки Б", !names.includes(fx.fridgeB), `HTTP ${eq.status}`);
}

// 3. Руководитель точки А (организация с офисом): чужое не меняет.
const headA = await login(fx.pointManagerA);
{
  const put = await req("PUT", `/api/equipment/${fx.fridgeB}`, headA, { name: "взлом" });
  check("руководитель точки А: правка холодильника точки Б — отказ", put.status === 403 || put.status === 404, `HTTP ${put.status}`);
  const del = await req("DELETE", `/api/equipment/${fx.fridgeB}`, headA);
  check("руководитель точки А: удаление холодильника точки Б — отказ", del.status === 403 || del.status === 404, `HTTP ${del.status}`);
  const dismiss = await req("POST", "/api/staff/schedules/dismissals", headA, { userId: fx.cookBId, date: "2026-11-02", reason: "проверка" });
  check("руководитель точки А: увольнение повара точки Б — отказ", dismiss.status === 403, `HTTP ${dismiss.status}`);
  const wipe = await req("POST", "/api/settings/journals/delete-all-documents", headA, { confirm: "УДАЛИТЬ" });
  check("руководитель точки А: удалить все документы организации — отказ", wipe.status === 403, `HTTP ${wipe.status}`);
  const perms = await req("PUT", "/api/organizations/permissions", headA, {});
  check("руководитель точки А: права сотрудников — отказ", perms.status === 403, `HTTP ${perms.status}`);
  const audit = await req("GET", "/api/audit", headA);
  check("руководитель точки А: журнал действий компании — отказ", audit.status === 403, `HTTP ${audit.status}`);
  const docB = await req("GET", `/api/journal-documents/${fx.hygieneDocB}`, headA);
  check("руководитель точки А: документ точки Б — не найден", docB.status === 404, `HTTP ${docB.status}`);
}

// 4. «Распределение» журнала — только своей организации.
{
  const res = await req("PUT", "/api/settings/journals/hygiene/distribution", ownerOrg, {
    fillMode: "single",
    defaultAssigneeId: null,
    allowedPositionIds: [],
    bonusAmountKopecks: 12300,
  });
  check("владелец: сохранение «Распределения» гигиены", res.status === 200, `HTTP ${res.status} ${res.text.slice(0, 120)}`);
  const client = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_ptinteg" });
  await client.connect();
  const tpl = await client.query('select "fillMode", "defaultAssigneeId", "bonusAmountKopecks" from "JournalTemplate" where code=$1', ["hygiene"]);
  const own = await client.query('select "fillMode", "bonusAmountKopecks" from "OrganizationJournalSetting" where "organizationId"=$1 and "templateId"=$2', [fx.orgId, fx.hygieneTemplateBefore.id]);
  await client.end();
  const before = fx.hygieneTemplateBefore;
  check(
    "общий шаблон гигиены не изменился",
    tpl.rows[0].fillMode === before.fillMode && tpl.rows[0].bonusAmountKopecks === before.bonusAmountKopecks && tpl.rows[0].defaultAssigneeId === before.defaultAssigneeId,
    JSON.stringify(tpl.rows[0]),
  );
  check("настройка записана своей организации", own.rows[0]?.fillMode === "single" && own.rows[0]?.bonusAmountKopecks === 12300, JSON.stringify(own.rows[0] ?? null));
  const page = await req("GET", "/settings/journals", ownerOrg);
  check("/settings/journals после сохранения открывается", page.status === 200, `HTTP ${page.status}`);
}

const failed = out.filter((line) => line.startsWith("FAIL")).length;
out.push(failed ? `FAILED ${failed}/${out.length}` : `ALL PASS ${out.length}`);
console.log(out.at(-1));
writeFileSync(`${dir}/http-check.txt`, `${out.join("\n")}\n`);

// Регрессия прошлой волны (PR #88–#103) на нашей фикстуре: исправленное тогда не сломано.
// Адаптация point-deep-audit-2026-11-01/raw/http-check*.mjs (локальная wesetup_iso, prod-сборка на 3020).
// node .agent/tasks/point-isolation-audit-2026-11-01/raw/regress.mjs <out-file>
import pg from "pg";

import { check, fx, isNotFoundPage, login, req, save, withPoint } from "./http-lib.mjs";

const out = process.argv[2] ?? "regress.txt";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_iso" });
await db.connect();

const owner = await login(fx.users.owner.email);
const ownerOrg = withPoint(owner, "organization");
const ownerA = withPoint(owner, fx.pointA);
const ownerB = withPoint(owner, fx.pointB);
const cookA = await login(fx.users.cookA.email);
const headA = await login(fx.users.headA.email);

// 1. Страницы и API руководства открываются.
const pages = [
  "/dashboard", "/journals", "/journals/points", "/journals/hygiene", "/journals/cold_equipment_control",
  `/journals/hygiene/documents/${fx.docs.hygiene.A}`, `/journals/hygiene/documents/${fx.docs.hygiene.B}`,
  "/settings/journals", "/settings/journal-bonuses", "/settings/auto-journals", "/settings/equipment", "/settings/areas",
  "/settings/users", "/settings/kiosk", "/competencies", "/bonuses", "/mercury", "/inspection", "/settings/staff-health",
  "/settings/qr-posters", "/settings/inspectors", "/settings/schedule", "/team", "/checklists/assignments", "/losses/new",
  "/journals/sets/standard", "/settings/organization/branding", "/settings/api", "/inspection/special-mode",
];
for (const page of pages) {
  const res = await req("GET", page, ownerOrg);
  check(`владелец: ${page} открывается`, res.status === 200 && !res.text.includes("NEXT_HTTP_ERROR_FALLBACK;404"), `HTTP ${res.status}`);
}
for (const api of ["/api/mini/home", "/api/equipment", "/api/areas", "/api/journals/today-status", "/api/team", "/api/checklists/assignments", "/api/staff/inspectors-auditors", "/api/settings/badge", "/api/organizations/permissions"]) {
  const res = await req("GET", api, ownerOrg);
  check(`владелец: ${api} отвечает`, res.status === 200, `HTTP ${res.status}`);
}

// 2. Оборудование: «Вся организация» — оба, точка А — только А.
{
  const all = JSON.stringify((await req("GET", "/api/equipment", ownerOrg)).json);
  check("владелец «Вся организация»: оба холодильника", all.includes(fx.fridgeA) && all.includes(fx.fridgeB));
  const a = JSON.stringify((await req("GET", "/api/equipment", ownerA)).json);
  check("владелец на точке А: только холодильник А", a.includes(fx.fridgeA) && !a.includes(fx.fridgeB));
}

// 3. Повар А: документ точки Б не открыть.
{
  const own = await req("GET", `/api/journal-documents/${fx.docs.hygiene.A}`, cookA);
  const foreign = await req("GET", `/api/journal-documents/${fx.docs.hygiene.B}`, cookA);
  check("повар А: свой документ открывается", own.status === 200, `HTTP ${own.status}`);
  check("повар А: документ точки Б — не найден", foreign.status === 404, `HTTP ${foreign.status}`);
  const page = await req("GET", `/journals/hygiene/documents/${fx.docs.hygiene.B}`, cookA);
  check("повар А: страница документа точки Б — «не найдено»", isNotFoundPage(page) && !page.text.includes("Гигиена Бета"), `HTTP ${page.status}`);
  const eq = JSON.stringify((await req("GET", "/api/equipment", cookA)).json);
  check("повар А: нет холодильника точки Б", !eq.includes(fx.fridgeB));
}

// 4. Руководитель точки А: чужое не меняет, общие разделы компании закрыты.
{
  const put = await req("PUT", `/api/equipment/${fx.fridgeB}`, headA, { name: "взлом" });
  check("РТ А: правка холодильника точки Б — отказ", put.status === 403 || put.status === 404, `HTTP ${put.status}`);
  const dismiss = await req("POST", "/api/staff/schedules/dismissals", headA, { userId: fx.users.cookB.id, date: "2026-11-02", reason: "проверка" });
  check("РТ А: увольнение повара Б — отказ", dismiss.status === 403, `HTTP ${dismiss.status}`);
  const wipe = await req("POST", "/api/settings/journals/delete-all-documents", headA, { confirm: "УДАЛИТЬ" });
  check("РТ А: удалить все документы — отказ", wipe.status === 403 || wipe.status === 401, `HTTP ${wipe.status}`);
  const audit = await req("GET", "/api/audit", headA);
  check("РТ А: журнал действий компании — отказ", audit.status === 403, `HTTP ${audit.status}`);
  const docB = await req("GET", `/api/journal-documents/${fx.docs.hygiene.B}`, headA);
  check("РТ А: документ точки Б — не найден", docB.status === 404, `HTTP ${docB.status}`);
  const own = await req("PUT", `/api/equipment/${fx.fridgeA}`, headA, { name: "ШХ Альфа" });
  check("РТ А: свой холодильник правится", own.status === 200, `HTTP ${own.status}`);
}

// 5. Ссылки проверяющего, партии и CAPA — по точке (волна 2).
{
  const foreign = await req("POST", "/api/settings/inspector-tokens", headA, { label: "чужая", periodFrom: "2026-10-01", periodTo: "2026-11-01", buildingId: fx.pointB });
  check("РТ А: ссылка проверяющего на точку Б — отказ", foreign.status === 403, `HTTP ${foreign.status}`);
  const own = await req("POST", "/api/settings/inspector-tokens", headA, { label: "своя", periodFrom: "2026-10-01", periodTo: "2026-11-01" });
  check("РТ А: ссылка на свою точку — выдана", own.status === 200 && own.json?.token?.buildingId === fx.pointA, `HTTP ${own.status}`);
  if (own.json?.token?.id) await db.query('delete from "InspectorToken" where id=$1', [own.json.token.id]);
  const batch = await req("GET", `/api/batches/${fx.data.B.batch}`, headA);
  check("РТ А: партия точки Б — не найдена", batch.status === 404 || batch.status === 403, `HTTP ${batch.status}`);
  const capa = await req("PATCH", `/api/capa/${fx.data.B.capa}`, headA, { status: "closed" });
  check("РТ А: закрыть CAPA точки Б — отказ", capa.status === 404 || capa.status === 403, `HTTP ${capa.status}`);
  const listA = await req("GET", "/api/capa", ownerA);
  check("владелец на точке А: CAPA точки Б в списке нет", !listA.text.includes(fx.data.B.capa), `HTTP ${listA.status}`);
  const listOrg = await req("GET", "/api/capa", ownerOrg);
  check("владелец «Вся организация»: CAPA точки Б в списке есть", listOrg.text.includes(fx.data.B.capa), `HTTP ${listOrg.status}`);
  const batchesB = await req("GET", "/api/batches", ownerB);
  check("владелец на точке Б: партия точки Б в списке есть", batchesB.text.includes(fx.data.B.batch), `HTTP ${batchesB.status}`);
}

// 6. «Распределение» — своей организации; общий шаблон не меняется (владелец).
{
  const tplBefore = (await db.query('select "fillMode", "defaultAssigneeId", "bonusAmountKopecks" from "JournalTemplate" where code=$1', ["hygiene"])).rows[0];
  const res = await req("PUT", "/api/settings/journals/hygiene/distribution", ownerOrg, { fillMode: "single", defaultAssigneeId: null, allowedPositionIds: [] });
  check("владелец: «Распределение» гигиены сохраняется", res.status === 200, `HTTP ${res.status} ${res.text.slice(0, 120)}`);
  const tplAfter = (await db.query('select "fillMode", "defaultAssigneeId", "bonusAmountKopecks" from "JournalTemplate" where code=$1', ["hygiene"])).rows[0];
  check("общий шаблон гигиены не изменился", JSON.stringify(tplBefore) === JSON.stringify(tplAfter), JSON.stringify(tplAfter));
  await db.query('delete from "OrganizationJournalSetting" where "organizationId"=$1', [fx.orgId]);
}

await db.end();
save(out);

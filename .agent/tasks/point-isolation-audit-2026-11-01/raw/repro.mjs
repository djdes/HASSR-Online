// Воспроизведение находок аудита (локальная wesetup_iso, prod-сборка на 3020 — не прод).
// PASS — безопасное поведение (ожидаемое после правок), FAIL — находка воспроизводится.
// Записывающие проверки возвращают данные на место.
// node .agent/tasks/point-isolation-audit-2026-11-01/raw/repro.mjs <out-file>
import pg from "pg";

import { check, fx, isNotFoundPage, login, note, req, save, withPoint } from "./http-lib.mjs";

const out = process.argv[2] ?? "repro.txt";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_iso" });
await db.connect();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0] ?? null;

const B_PEOPLE = ["Повар Бета", "Руководитель Бета"];
const hasAny = (text, list) => list.filter((item) => (text ?? "").includes(item));
const denied = (res) => res.status === 401 || res.status === 403 || res.status === 404;

const cookA = await login(fx.users.cookA.email);
const headA = await login(fx.users.headA.email);
const owner = await login(fx.users.owner.email);
const ownerA = withPoint(owner, fx.pointA);
const ownerOrg = withPoint(owner, "organization");

// ── 1. Чтение на всю компанию руководителю точки ─────────────────────────────
for (const path of [
  "/api/settings/organization/export",
  "/api/settings/rpn-appendix",
  "/api/settings/external-token",
  "/api/organizations/permissions",
  "/api/staff/control-group",
  "/api/settings/subscription/transition",
  "/api/settings/master-cabinet",
  "/api/settings/badge",
  "/api/settings/webhooks",
  "/api/settings/webhooks/subscriptions",
  "/api/manager-scope",
  "/api/integrations/tasksflow/audit",
  "/api/integrations/tasksflow/links",
  "/api/settings/supply/iiko/stores",
]) {
  const res = await req("GET", path, headA);
  const leaked = hasAny(res.text, [...B_PEOPLE, "ШХ Бета", "Точка Б", fx.more.externalToken, "iso-webhook-secret"]);
  check(`РТ А: GET ${path} — закрыто (403) или без точки Б`, denied(res) || (res.status === 200 && leaked.length === 0 && !path.includes("external-token") && !path.includes("subscriptions")), `HTTP ${res.status}${leaked.length ? ` · видно: ${leaked.join(", ")}` : ""}`);
}
// Владелец по-прежнему получает эти данные.
for (const path of ["/api/settings/organization/export", "/api/settings/external-token", "/api/organizations/permissions", "/api/staff/control-group", "/api/settings/badge"]) {
  const res = await req("GET", path, ownerOrg);
  check(`владелец: GET ${path} — доступно`, res.status === 200, `HTTP ${res.status}`);
}

// ── 2. Изменение общих настроек компании руководителем точки ───────────────────
{
  const before = await one('select "badgeEnabled" from "Organization" where id=$1', [fx.orgId]);
  const res = await req("PATCH", "/api/settings/badge", headA, { enabled: !before.badgeEnabled });
  const after = await one('select "badgeEnabled" from "Organization" where id=$1', [fx.orgId]);
  check("РТ А: PATCH /api/settings/badge (бейдж всей компании) — отказ", denied(res) && after.badgeEnabled === before.badgeEnabled, `HTTP ${res.status}`);
  await db.query('update "Organization" set "badgeEnabled"=$2 where id=$1', [fx.orgId, before.badgeEnabled]);
}
{
  const res = await req("PATCH", "/api/settings/journal-controls", headA, { setup: { code: "finished_product", decision: "declined" } });
  check("РТ А: PATCH /api/settings/journal-controls (спецрежим компании) — отказ", denied(res), `HTTP ${res.status}`);
}
{
  const res = await req("PUT", "/api/settings/journals/hygiene/distribution", headA, { fillMode: "single", defaultAssigneeId: fx.users.cookB.id, allowedPositionIds: [] });
  check("РТ А: PUT распределения журнала (на всю организацию) — отказ", denied(res), `HTTP ${res.status}`);
  await db.query('delete from "OrganizationJournalSetting" where "organizationId"=$1', [fx.orgId]);
}
{
  const res = await req("PUT", "/api/settings/journals/hygiene/bonus", headA, { rubles: 1 });
  check("РТ А: PUT бонуса журнала (закрытая страница) — отказ", denied(res), `HTTP ${res.status}`);
  await db.query('delete from "OrganizationJournalSetting" where "organizationId"=$1', [fx.orgId]);
}
{
  const orgBefore = await one('select name, inn, type, "perLocationJournals" from "Organization" where id=$1', [fx.orgId]);
  const cookBefore = await one('select name, phone, "jobPositionId", "positionTitle" from "User" where id=$1', [fx.users.cookA.id]);
  const res = await req("POST", "/api/profile/complete", cookA, { organizationName: "Взлом ИСО", phone: "+79990000001", asEmployee: true, positionName: "Директор" });
  const orgAfter = await one('select name from "Organization" where id=$1', [fx.orgId]);
  check("повар А: POST /api/profile/complete (анкета компании) — отказ", denied(res) && orgAfter.name === orgBefore.name, `HTTP ${res.status} · название: ${orgAfter.name}`);
  await db.query('update "Organization" set name=$2, inn=$3, type=$4, "perLocationJournals"=$5 where id=$1', [fx.orgId, orgBefore.name, orgBefore.inn, orgBefore.type, orgBefore.perLocationJournals]);
  await db.query('update "User" set name=$2, phone=$3, "jobPositionId"=$4, "positionTitle"=$5 where id=$1', [fx.users.cookA.id, cookBefore.name, cookBefore.phone, cookBefore.jobPositionId, cookBefore.positionTitle]);
}

// ── 3. Люди всей компании и чужой точки ───────────────────────────────────────
{
  const before = await one('select "passwordHash" from "User" where id=$1', [fx.more.officeA.id]);
  const res = await req("POST", `/api/staff/${fx.more.officeA.id}/credentials`, headA, { password: "Hacked-2026!" });
  const after = await one('select "passwordHash" from "User" where id=$1', [fx.more.officeA.id]);
  check("РТ А: смена пароля руководителю всей компании (офис + точка А) — отказ", denied(res) && after.passwordHash === before.passwordHash, `HTTP ${res.status}`);
  await db.query('update "User" set "passwordHash"=$2 where id=$1', [fx.more.officeA.id, before.passwordHash]);
}
{
  const page = await req("GET", `/reports/by-user/${fx.users.cookB.id}`, headA);
  check("РТ А: /reports/by-user/<повар Б> — «не найдено»", isNotFoundPage(page) && !page.text.includes("Повар Бета"), `HTTP ${page.status}`);
  const cert = await req("GET", `/api/certificate/staff?userId=${fx.users.cookB.id}`, headA);
  check("РТ А: сертификат повара Б — отказ", denied(cert), `HTTP ${cert.status}`);
}
{
  const before = await one('select status, "verificationStatus" from "JournalTaskClaim" where id=$1', [fx.more.claimB]);
  const res = await req("POST", `/api/verifications/${fx.more.claimB}`, headA, { action: "reject", comment: "проверка изоляции" });
  const after = await one('select status, "verificationStatus" from "JournalTaskClaim" where id=$1', [fx.more.claimB]);
  check("РТ А: вернуть на переделку задачу повара Б — отказ", denied(res) && after.verificationStatus === before.verificationStatus, `HTTP ${res.status} · ${after.verificationStatus}`);
  await db.query('update "JournalTaskClaim" set status=$2, "verificationStatus"=$3, "verifierComment"=null, "verifiedById"=null, "verifiedAt"=null where id=$1', [fx.more.claimB, before.status, before.verificationStatus]);
}
for (const [label, cookie] of [["РТ А", headA], ["владелец на точке А", ownerA]]) {
  for (const page of ["/bonuses", "/competencies", "/team", "/settings/schedule", "/settings/inspectors"]) {
    const res = await req("GET", page, cookie);
    const leaked = hasAny(res.text, [...B_PEOPLE, "Проверяющий Бета"]);
    check(`${label}: ${page} — без людей и ссылок точки Б`, res.status === 200 && leaked.length === 0, `HTTP ${res.status}${leaked.length ? ` · видно: ${leaked.join(", ")}` : ""}`);
  }
}
{
  const res = await req("GET", "/api/staff/inspectors-auditors", headA);
  const leaked = hasAny(res.text, [...B_PEOPLE, "Проверяющий Бета"]);
  check("РТ А: GET /api/staff/inspectors-auditors — без точки Б", res.status === 200 && leaked.length === 0, `HTTP ${res.status}${leaked.length ? ` · видно: ${leaked.join(", ")}` : ""}`);
  const team = await req("GET", "/api/team", ownerA);
  const t = hasAny(team.text, B_PEOPLE);
  check("владелец на точке А: GET /api/team — без людей точки Б", team.status === 200 && t.length === 0, `HTTP ${team.status}${t.length ? ` · видно: ${t.join(", ")}` : ""}`);
  const settingsJournals = await req("GET", "/settings/journals", headA);
  const s = hasAny(settingsJournals.text, B_PEOPLE);
  check("РТ А: /settings/journals — без людей точки Б", settingsJournals.status === 200 && s.length === 0, `HTTP ${settingsJournals.status}${s.length ? ` · видно: ${s.join(", ")}` : ""}`);
}

// ── 4. Объекты и записи чужой точки ──────────────────────────────────────────
{
  const before = await one('select name, "tempMin", "tempMax" from "Equipment" where id=$1', [fx.fridgeB]);
  const res = await req("POST", `/api/journal-documents/${fx.docs.cold_equipment_control.A}/cold-equipment`, headA, {
    action: "save_equipment",
    item: { sourceEquipmentId: fx.fridgeB, name: "ШХ Бета ВЗЛОМ", min: -50, max: 50 },
  });
  const after = await one('select name, "tempMin", "tempMax" from "Equipment" where id=$1', [fx.fridgeB]);
  check("РТ А: холодильник точки Б через журнал точки А — не меняется", after.name === before.name && after.tempMin === before.tempMin && after.tempMax === before.tempMax, `HTTP ${res.status} · ${after.name} ${after.tempMin}…${after.tempMax}`);
  await db.query('update "Equipment" set name=$2, "tempMin"=$3, "tempMax"=$4 where id=$1', [fx.fridgeB, before.name, before.tempMin, before.tempMax]);
}
{
  const res = await req("POST", `/api/journals/cleaning/documents/${fx.docs.cleaning.A}/room-scopes`, headA, { roomId: fx.roomB, currentScope: ["ВЗЛОМ пункт"], generalScope: [] });
  const items = await one(`select count(*)::int as n from "JournalChecklistItem" where "roomId"=$1 and label like 'ВЗЛОМ%' and "archivedAt" is null`, [fx.roomB]).catch(() => ({ n: -1 }));
  check("РТ А: чек-лист уборки помещения точки Б через документ А — отказ", denied(res) || res.status === 400, `HTTP ${res.status} · пунктов: ${items?.n}`);
  await db.query(`delete from "JournalChecklistItem" where "roomId"=$1 and label like 'ВЗЛОМ%'`, [fx.roomB]).catch(() => null);
}
{
  const suggest = await req("GET", "/api/losses/product-suggest", cookA);
  check("повар А: подсказки товаров потерь — без списаний точки Б", !suggest.text.includes("Списание Бета"), `HTTP ${suggest.status}`);
  const page = await req("GET", "/losses/new", headA);
  check("РТ А: /losses/new — без цехов точки Б", page.status === 200 && !page.text.includes("Цех Бета"), `HTTP ${page.status}`);
  const pageOwner = await req("GET", "/losses/new", ownerA);
  check("владелец на точке А: /losses/new — без цехов точки Б", pageOwner.status === 200 && !pageOwner.text.includes("Цех Бета"), `HTTP ${pageOwner.status}`);
  const res = await req("POST", "/api/losses", cookA, { productName: "ВЗЛОМ потеря", quantity: 1, areaId: fx.areaB });
  check("повар А: потеря в цех точки Б — отказ", denied(res), `HTTP ${res.status}`);
  await db.query(`delete from "LossRecord" where "productName"='ВЗЛОМ потеря'`);
}
{
  const page = await req("GET", "/checklists/assignments", headA);
  const leaked = hasAny(page.text, [...B_PEOPLE, "Точка Б"]);
  check("РТ А: /checklists/assignments — без людей и точки Б", page.status === 200 && leaked.length === 0, `HTTP ${page.status}${leaked.length ? ` · видно: ${leaked.join(", ")}` : ""}`);
  const list = await req("GET", "/api/checklists/assignments", headA);
  const ids = JSON.stringify(list.json ?? {});
  check("РТ А: GET /api/checklists/assignments — без назначений точки Б", list.status === 200 && !ids.includes(fx.more.assignB) && !ids.includes(fx.more.assignCookB), `HTTP ${list.status}`);
  const create = await req("POST", "/api/checklists/assignments", headA, { templateId: fx.more.checklistTemplate, targetKind: "building", targetId: fx.pointB, frequency: "daily", dueTime: "12:00", remindTelegram: false });
  check("РТ А: назначить чек-лист точке Б — отказ", denied(create), `HTTP ${create.status}`);
  if (create.json?.assignment?.id) await db.query('delete from "ChecklistAssignment" where id=$1', [create.json.assignment.id]);
  const toggle = await req("PATCH", `/api/checklists/assignments/${fx.more.assignB}`, headA, { active: false });
  const row = await one('select active from "ChecklistAssignment" where id=$1', [fx.more.assignB]).catch(() => null);
  check("РТ А: приостановить назначение точки Б — отказ", denied(toggle), `HTTP ${toggle.status} · active=${row?.active}`);
  await db.query('update "ChecklistAssignment" set active=true where id=$1', [fx.more.assignB]).catch(() => null);
  const own = await req("PATCH", `/api/checklists/assignments/${fx.more.assignA}`, headA, { active: true });
  check("РТ А: своё назначение точки А — можно", own.status === 200, `HTTP ${own.status}`);
}
{
  const page = await req("GET", "/inspection/visits", headA);
  check("РТ А: /inspection/visits — без посещений по ссылке точки Б", page.status === 200 && !page.text.includes("Инспектор Бета"), `HTTP ${page.status}`);
  const api = await req("GET", "/api/inspection/visits", headA);
  check("РТ А: GET /api/inspection/visits — без посещений точки Б", !api.text.includes("Инспектор Бета"), `HTTP ${api.status}`);
}

// ── 5. QR и печать ────────────────────────────────────────────────────────────
{
  const page = await req("GET", "/settings/qr-posters?journal=hygiene", headA);
  check("РТ А: QR-коды гигиены — без документа точки Б", page.status === 200 && !page.text.includes(fx.docs.hygiene.B), `HTTP ${page.status}`);
  const poster = await req("GET", `/api/qr-fill/journal/hygiene:${fx.docs.hygiene.B}`, headA);
  check("РТ А: QR документа гигиены точки Б по id — отказ", denied(poster), `HTTP ${poster.status}`);
}
{
  const shared = fx.more.sharedDoc;
  if (shared) {
    const res = await req("POST", "/api/print/jobs", withPoint(cookA, fx.pointA), { documentId: shared });
    const job = res.json?.jobId ?? res.json?.id ?? res.json?.job?.id;
    const row = job ? await one('select "buildingId" from "PrintJob" where id=$1', [job]) : null;
    check("повар А: печать общего журнала — задание точки А, не общей очереди", row?.buildingId === fx.pointA, `HTTP ${res.status} · buildingId=${row?.buildingId ?? "null"}`);
    if (job) await db.query('delete from "PrintJob" where id=$1', [job]);
  } else note("нет общего документа для проверки печати");
}

await db.end();
save(out);

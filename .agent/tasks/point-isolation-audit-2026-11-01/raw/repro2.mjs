// Воспроизведение второй волны находок (локальная wesetup_iso, prod-сборка на 3020 — не прод).
// Готовит свои данные (люди «Кондитер», проверка по чек-листу точки Б), проверяет и убирает за собой.
// node .agent/tasks/point-isolation-audit-2026-11-01/raw/repro2.mjs <out-file>
import { randomUUID } from "node:crypto";

import pg from "pg";

import { check, fx, login, note, req, save, withPoint } from "./http-lib.mjs";

const out = process.argv[2] ?? "repro2.txt";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_iso" });
await db.connect();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0] ?? null;
const denied = (res) => res.status === 401 || res.status === 403 || res.status === 404;

const cookA = await login(fx.users.cookA.email);
const headA = await login(fx.users.headA.email);
const owner = await login(fx.users.owner.email);

// ── Уборщик помещения точки А — человек точки Б ─────────────────────────────
{
  const before = await one('select "cleanerUserIds" from "Room" where id=$1', [fx.roomA]);
  const res = await req("PATCH", `/api/settings/rooms/${fx.roomA}`, headA, { cleanerUserIds: [fx.users.cookB.id] });
  const after = await one('select "cleanerUserIds" from "Room" where id=$1', [fx.roomA]);
  check("РТ А: уборщик своего помещения — человек точки Б — отказ", !(after.cleanerUserIds ?? []).includes(fx.users.cookB.id), `HTTP ${res.status} · ${JSON.stringify(after.cleanerUserIds)}`);
  await db.query('update "Room" set "cleanerUserIds"=$2 where id=$1', [fx.roomA, before.cleanerUserIds]);
}

// ── Оборудование по общему документу ─────────────────────────────────────────
{
  const res = await req("GET", `/api/equipment?documentId=${fx.more.sharedDoc}`, cookA);
  check("повар А: /api/equipment по общему документу — без холодильника точки Б", res.status === 200 && !res.text.includes("ШХ Бета"), `HTTP ${res.status}`);
  const foreign = await req("GET", `/api/equipment?documentId=${fx.docs.cold_equipment_control.B}`, cookA);
  check("повар А: /api/equipment по документу точки Б — без её холодильника", !foreign.text.includes("ШХ Бета"), `HTTP ${foreign.status}`);
}

// ── QR «через вход»: руководитель точки А на наклейке точки Б ────────────────
{
  const mode = await one('select "qrFillMode" from "Organization" where id=$1', [fx.orgId]);
  await db.query(`update "Organization" set "qrFillMode"='auth' where id=$1`, [fx.orgId]);
  const page = await req("GET", `/equipment-fill/${fx.fridgeB}`, headA);
  check("РТ А (QR через вход): наклейка холодильника Б — без выбора людей точки Б", !page.text.includes("Повар Бета"), `HTTP ${page.status}`);
  await db.query('update "Organization" set "qrFillMode"=$2 where id=$1', [fx.orgId, mode.qrFillMode]);
}

// ── Преемник уволенного — с его точки ────────────────────────────────────────
{
  const pos = await one(`insert into "JobPosition"(id, "organizationId", "categoryKey", name, "sortOrder", "updatedAt") values ($1,$2,'staff','Кондитер ИСО',5,now()) returning id`, [`iso-pos-${randomUUID()}`, fx.orgId]);
  const hash = await one('select "passwordHash" from "User" where id=$1', [fx.users.cookA.id]);
  const mk = async (email, name, buildingIds) =>
    one(`insert into "User"(id, "organizationId", email, name, role, "buildingIds", "jobPositionId", "passwordHash", "isActive", "createdAt") values ($1,$2,$3,$4,'cook',$5,$6,$7,true, now()) returning id`, [`iso-u-${randomUUID()}`, fx.orgId, email, name, buildingIds, pos.id, hash.passwordHash]);
  const b2 = await mk(`iso-konditer-b-${Date.now()}@verify.local`, "Кондитер Бета", [fx.pointB]);
  const a4 = await mk(`iso-konditer-a-${Date.now()}@verify.local`, "Кондитер Альфа", [fx.pointA]);
  const a5 = await mk(`iso-konditer-a5-${Date.now()}@verify.local`, "Кондитер Альфа-уходит", [fx.pointA]);
  const res = await req("PUT", `/api/users/${a5.id}`, withPoint(owner, fx.pointA), { isActive: false });
  let audit = null;
  for (let i = 0; i < 20 && !audit; i++) {
    audit = await one(`select details from "AuditLog" where "entityId"=$1 and action='offboarding.complete'`, [a5.id]);
    if (!audit) await new Promise((r) => setTimeout(r, 500));
  }
  const successor = audit?.details?.successorName ?? null;
  check("увольнение кондитера точки А: преемник — с точки А, не с точки Б", successor !== "Кондитер Бета", `HTTP ${res.status} · преемник: ${successor ?? "—"}`);
  await db.query('delete from "User" where id = any($1)', [[b2.id, a4.id, a5.id]]);
  await db.query('delete from "JobPosition" where id=$1', [pos.id]);
}

// ── Проверка по чек-листу точки Б по id ──────────────────────────────────────
{
  const tpl = await one('select version, definition from "ChecklistTemplate" where id=$1', [fx.more.checklistTemplate]);
  const inspection = await one(
    `insert into "ChecklistInspection"(id, "organizationId", "templateId", title, "templateVersion", snapshot, "createdById", "createdByName", "assignmentId", status, "updatedAt") values ($1,$2,$3,'Проверка Бета',$4,$5,$6,'Повар Бета',$7,'draft',now()) returning id`,
    [`iso-insp-${randomUUID()}`, fx.orgId, fx.more.checklistTemplate, tpl.version, tpl.definition, fx.users.cookB.id, fx.more.assignB],
  ).catch((error) => {
    note(`проверку не создать: ${error.message}`);
    return null;
  });
  if (inspection) {
    const res = await req("GET", `/api/checklists/inspections/${inspection.id}`, headA);
    check("РТ А: проверка по чек-листу точки Б по id — не видна", denied(res), `HTTP ${res.status}`);
    const list = await req("GET", "/api/checklists/inspections", headA);
    check("РТ А: список проверок — без проверки точки Б", !list.text.includes(inspection.id), `HTTP ${list.status}`);
    await db.query('delete from "ChecklistInspection" where id=$1', [inspection.id]);
  }
}

await db.end();
save(out);

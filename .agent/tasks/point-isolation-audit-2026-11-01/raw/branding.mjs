// Фирменный стиль по организациям (локальная wesetup_iso, prod-сборка на 3020 — не прод).
// Владелец заводит вторую организацию «как текущая», затем меняет логотип и цвета
// в каждой и смотрит, не меняется ли другая.
// node .agent/tasks/point-isolation-audit-2026-11-01/raw/branding.mjs <out-file>
import { randomUUID } from "node:crypto";

import pg from "pg";

import { base, check, fx, login, note, req, save, withPoint } from "./http-lib.mjs";

const out = process.argv[2] ?? "branding.txt";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_iso" });
await db.connect();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0] ?? null;

// Аккаунт владельца (в фикстуре его нет): организация «ISO Точки» — его.
let account = await one('select id from "Account" where "ownerUserId"=$1', [fx.users.owner.id]);
if (!account) {
  account = await one(`insert into "Account"(id, "ownerUserId", "updatedAt") values ($1,$2,now()) returning id`, [`iso-acc-${randomUUID()}`, fx.users.owner.id]);
}
await db.query('update "Organization" set "accountId"=$2 where id=$1', [fx.orgId, account.id]);

// Логотипы — маленькие SVG (PNG ограничен размерами в пикселях).
const svg = (fill) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${fill}"/></svg>`);
const LOGO_RED = svg("#ff0000");
const LOGO_BLUE = svg("#0000ff");
async function uploadLogo(cookie, bytes) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/svg+xml" }), "logo.svg");
  const res = await fetch(`${base}/api/settings/organization/logo`, { method: "POST", headers: { cookie }, body: form });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function switchTo(cookie, organizationId) {
  const res = await fetch(`${base}/api/me/active-organization`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
  // Новая кука сессии с активной организацией.
  const jar = new Map(cookie.split("; ").map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]));
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
  }
  return { status: res.status, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
}

let owner = withPoint(await login(fx.users.owner.email), "organization");
// Логотип и цвет первой организации — до создания второй.
const logo1 = await uploadLogo(owner, LOGO_RED);
note(`логотип организации 1: HTTP ${logo1.status} ${logo1.json?.logoUrl ?? ""}`);
await req("PATCH", "/api/settings/organization", owner, { brandColor: "#112233" });

const created = await req("POST", "/api/organizations", owner, { name: `ISO Вторая ${Date.now()}`, sphere: "restaurant", copyFrom: "current" });
const org2Id = created.json?.organizationId;
check("владелец: вторая организация создана", created.status === 200 && Boolean(org2Id), `HTTP ${created.status} ${created.text.slice(0, 120)}`);
const second = await one('select "logoUrl", "brandColor" from "Organization" where id=$1', [org2Id]);
check(
  "вторая организация: логотип — свой (не ссылка на файл первой)",
  !String(second?.logoUrl ?? "").includes(fx.orgId),
  `logoUrl=${second?.logoUrl}`,
);

// Меняем логотип и цвет в первой — вторая не должна измениться.
const before2 = await one('select "logoUrl", "brandColor" from "Organization" where id=$1', [org2Id]);
await uploadLogo(owner, LOGO_BLUE);
await req("PATCH", "/api/settings/organization", owner, { brandColor: "#445566" });
const after2 = await one('select "logoUrl", "brandColor" from "Organization" where id=$1', [org2Id]);
const served2 = after2?.logoUrl ? await fetch(`${base}${after2.logoUrl}`).then((r) => r.arrayBuffer()).then((b) => Buffer.from(b)) : null;
const served1 = await fetch(`${base}${(await one('select "logoUrl" from "Organization" where id=$1', [fx.orgId])).logoUrl}`).then((r) => r.arrayBuffer()).then((b) => Buffer.from(b));
check("смена цвета в первой не меняет цвет второй", after2?.brandColor === before2?.brandColor, `${before2?.brandColor} → ${after2?.brandColor}`);
check("смена логотипа в первой не меняет картинку второй", !served2 || !served2.equals(served1), `вторая отдаёт ${served2?.length ?? 0} байт, первая ${served1.length}`);

// Переходим во вторую организацию и настраиваем её стиль.
const switched = await switchTo(owner, org2Id);
owner = switched.cookie;
const logoOwn = await uploadLogo(owner, LOGO_RED);
const colorOwn = await req("PATCH", "/api/settings/organization", owner, { brandColor: "#778899" });
const first = await one('select "brandColor" from "Organization" where id=$1', [fx.orgId]);
const secondNow = await one('select "logoUrl", "brandColor" from "Organization" where id=$1', [org2Id]);
check("во второй организации стиль настраивается", logoOwn.status === 200 && colorOwn.status === 200 && secondNow?.brandColor === "#778899", `логотип HTTP ${logoOwn.status}, цвет HTTP ${colorOwn.status}, цвет=${secondNow?.brandColor}`);
check("настройка второй не трогает первую", first?.brandColor === "#445566", `цвет первой=${first?.brandColor}`);

// Убираем за собой: вторая организация и её члены.
await db.query('delete from "OrganizationMember" where "organizationId"=$1', [org2Id]).catch(() => null);
await db.query('delete from "OrganizationLogo" where "organizationId"=$1', [org2Id]).catch(() => null);
await db.query('delete from "AuditLog" where "organizationId"=$1', [org2Id]).catch(() => null);
await db.query('delete from "JobPosition" where "organizationId"=$1', [org2Id]).catch(() => null);
await db.query('delete from "Organization" where id=$1', [org2Id]).catch((error) => note(`не удалить вторую организацию: ${error.message}`));
await db.query('update "User" set "lastActiveOrganizationId"=null where id=$1', [fx.users.owner.id]);
await db.end();
save(out);

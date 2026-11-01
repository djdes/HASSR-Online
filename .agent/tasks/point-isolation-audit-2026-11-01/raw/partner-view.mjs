// Партнёр с доступом «только просмотр» меняет реквизиты клиента (локальная wesetup_iso, prod-сборка на 3020).
// node .agent/tasks/point-isolation-audit-2026-11-01/raw/partner-view.mjs <out-file>
import { randomUUID } from "node:crypto";
import pg from "pg";
import { base, check, fx, login, req, save } from "./http-lib.mjs";

const out = process.argv[2] ?? "partner-view.txt";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_iso" });
await db.connect();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0] ?? null;

const email = "iso-partner@verify.local";
let user = await one('select id from "User" where email=$1', [email]);
if (!user) {
  const hash = await one('select "passwordHash" from "User" where id=$1', [fx.users.cookA.id]);
  const org = await one(`insert into "Organization"(id, name, type, "updatedAt") values ($1,'ISO Партнёр','restaurant',now()) returning id`, [`iso-porg-${randomUUID()}`]);
  user = await one(`insert into "User"(id, "organizationId", email, name, role, "passwordHash", "isActive", "legalVersion", "showWhatsNew", phone, "createdAt") values ($1,$2,$3,'Партнёр ИСО','owner',$4,true,'2026-09-30',false,'+79990001122', now()) returning id`, [`iso-pu-${randomUUID()}`, org.id, email, hash.passwordHash]);
  const partner = await one(`insert into "Partner"(id, slug, code, type, "companyName", inn, city, phone, "contactEmail", "termsAcceptedAt", "applicantUserId", status, "updatedAt") values ($1,$2,$3,'consultant','ISO Партнёр','7700000000','Москва','+79990001122',$4,now(),$5,'active',now()) returning id`, [`iso-p-${randomUUID()}`, `iso-p-${Date.now()}`, `ISOP${Date.now()}`, email, user.id]);
  await db.query(`insert into "PartnerUser"(id, "partnerId", "userId") values ($1,$2,$3)`, [`iso-pu-link-${randomUUID()}`, partner.id, user.id]);
  await db.query(`insert into "PartnerClient"(id, "partnerId", "organizationId", "accessLevel") values ($1,$2,$3,'view')`, [`iso-pc-${randomUUID()}`, partner.id, fx.org2.orgId]);
}
const before = await one('select name, timezone from "Organization" where id=$1', [fx.org2.orgId]);
const cookie = await login(email);
const res = await req("PATCH", `/api/partner/clients/${fx.org2.orgId}`, cookie, { name: "ISO Чужая ВЗЛОМ", timezone: "Asia/Tokyo" });
const after = await one('select name, timezone from "Organization" where id=$1', [fx.org2.orgId]);
check("партнёр «только просмотр»: PATCH реквизитов клиента — отказ", (res.status === 403 || res.status === 404) && after.name === before.name, `HTTP ${res.status} · название: ${after.name}, пояс: ${after.timezone}`);
await db.query('update "Organization" set name=$2, timezone=$3 where id=$1', [fx.org2.orgId, before.name, before.timezone]);

// Партнёр открывает кабинет клиента («просмотр») и просит общий ключ внешнего API.
const open = await fetch(`${base}/api/partner/clients/${fx.org2.orgId}/open`, { method: "POST", headers: { cookie } });
const jar = new Map(cookie.split("; ").map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]));
for (const raw of open.headers.getSetCookie?.() ?? []) {
  const [pair] = raw.split(";");
  jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
}
const inside = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const token = await req("GET", "/api/settings/external-token", inside);
check("партнёр в кабинете клиента: ключ внешнего API не выдаётся", token.status === 403 && !token.text.includes("iso-ext-org2-secret"), `открытие HTTP ${open.status} · ключ HTTP ${token.status}${token.text.includes("iso-ext-org2-secret") ? " · ключ виден" : ""}`);
await db.end();
save(out);

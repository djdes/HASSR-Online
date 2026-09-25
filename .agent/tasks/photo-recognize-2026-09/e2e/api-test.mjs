// AC2: API checks of POST /api/ai/vision-extract (+ /api/ocr/label) against the local dev server with the mock reply.
import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";

const require = createRequire("C:/wt/qrforms/package.json");
const { Client } = require("pg");

const BASE = "http://localhost:3042";
const TMP = "C:/Users/Yaroslav/AppData/Local/Temp/18/wesetup-vision";
const EV = "C:/wt/qrforms/.agent/tasks/photo-recognize-2026-09/evidence";
const env = Object.fromEntries(
  readFileSync("C:/wt/qrforms/.env", "utf8")
    .split(/\r?\n/)
    .map((line) => /^([A-Z_]+)=(.*)$/.exec(line.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"|"$/g, "")])
);

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const jar = new Map();
function remember(response) {
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(";");
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function login(email, password) {
  jar.clear();
  let response = await fetch(`${BASE}/api/auth/csrf`);
  remember(response);
  const { csrfToken } = await response.json();
  response = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
    body: new URLSearchParams({ csrfToken, email, password, json: "true" }),
    redirect: "manual",
  });
  remember(response);
  response = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: cookieHeader() } });
  const session = await response.json();
  return session?.user ?? null;
}

function form(kind, files) {
  const body = new FormData();
  if (kind !== null) body.set("kind", kind);
  for (const [bytes, name, type] of files) body.append("photo", new Blob([bytes], { type }), name);
  return body;
}

async function extract(kind, files, withCookie = true) {
  const response = await fetch(`${BASE}/api/ai/vision-extract`, {
    method: "POST",
    headers: withCookie ? { cookie: cookieHeader() } : {},
    body: form(kind, files),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

const listTmp = () => (existsSync(TMP) ? readdirSync(TMP).filter((n) => /^[a-f0-9]{32}-(jpg|png|webp)$/.test(n)) : []);

const menuPng = readFileSync(`${EV}/ac1-menu-readable.png`);
const invoicePng = readFileSync(`${EV}/ac1-invoice.png`);

const db = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/wesetup_wt_qrforms" });
await db.connect();
await db.query(`delete from "AuditLog" where action = 'ai.vision_extract'`);
for (const name of listTmp()) unlinkSync(`${TMP}/${name}`);

// 1) Without a session.
{
  const r = await extract("menu", [[menuPng, "m.png", "image/png"]], false);
  check("без входа — 401", r.status === 401, `status=${r.status}`);
}

const user = await login("admin@haccp.local", env.ADMIN_PASSWORD);
check("вход admin@haccp.local", Boolean(user?.id), user ? `user=${user.id}` : "no session");
if (!user) process.exit(1);
const orgRow = await db.query(`select "organizationId" from "User" where id = $1`, [user.id]);
const orgId = orgRow.rows[0].organizationId;

// 2) Validation.
{
  let r = await extract("recipe", [[menuPng, "m.png", "image/png"]]);
  check("неизвестный kind — 400", r.status === 400 && r.json?.code === "bad_request", `${r.status} ${r.json?.error}`);
  r = await extract("menu", []);
  check("без фото — 400", r.status === 400, `${r.status} ${r.json?.error}`);
  r = await extract("menu", Array.from({ length: 4 }, (_, i) => [menuPng, `m${i}.png`, "image/png"]));
  check("4 фото — 400", r.status === 400, `${r.status} ${r.json?.error}`);
  r = await extract("menu", [[Buffer.from("<html>not an image</html>"), "x.jpg", "image/jpeg"]]);
  check("не картинка (подменён тип) — 415", r.status === 415 && r.json?.code === "bad_type", `${r.status} ${r.json?.error}`);
  const big = Buffer.alloc(6 * 1024 * 1024 + 10, 0);
  big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
  r = await extract("menu", [[big, "big.jpg", "image/jpeg"]]);
  check("фото больше 6 МБ — 413", r.status === 413 && r.json?.code === "too_large", `${r.status} ${r.json?.error}`);
}
check("отказы по вводу не оставили файлов", listTmp().length === 0, `files=${listTmp().length}`);

// 3) Menu with the mock (3 s delay): file appears while waiting, disappears after the answer.
{
  let seen = 0;
  const poll = setInterval(() => (seen = Math.max(seen, listTmp().length)), 150);
  const started = Date.now();
  const r = await extract("menu", [[menuPng, "photo-1.jpg", "image/png"], [invoicePng, "photo-2.jpg", "image/png"]]);
  clearInterval(poll);
  const ms = Date.now() - started;
  check(
    "меню с моком — 200, 5 строк из ```json-ответа",
    r.status === 200 && r.json?.kind === "menu" && r.json?.items?.length === 5 && r.json.photos === 2,
    `status=${r.status} items=${r.json?.items?.length} first=${JSON.stringify(r.json?.items?.[0])} ms=${ms}`
  );
  check("во время распознавания фото лежат во временной папке", seen === 2, `максимум файлов=${seen}`);
  check("после ответа фото удалены", listTmp().length === 0, `files=${listTmp().length}`);
  const audit = await db.query(
    `select details from "AuditLog" where action='ai.vision_extract' and "entityId"=$1 order by "createdAt" desc limit 1`,
    [user.id]
  );
  const details = audit.rows[0]?.details;
  check("запись в журнале действий с итогом", details?.result === "ok" && details?.recognized === 5 && details?.photos === 2, JSON.stringify(details));
}

// 4) Raw + generic + label (contract of /api/ocr/label kept).
{
  let r = await extract("raw", [[invoicePng, "photo-1.jpg", "image/png"]]);
  check(
    "сырьё с моком — 4 строки с изготовителем, поставщиком, сроком",
    r.status === 200 && r.json?.items?.length === 4 && r.json.items[1].supplier === "ООО «Северная ферма»" && r.json.items[1].expiryDate === "2026-10-01",
    JSON.stringify(r.json?.items?.[1])
  );
  r = await extract("generic", [[invoicePng, "photo-1.jpg", "image/png"]]);
  check("список с моком — 2 строки", r.status === 200 && r.json?.items?.length === 2, JSON.stringify(r.json?.items));
  const body = new FormData();
  body.append("photo", new Blob([menuPng], { type: "image/png" }), "label.png");
  const response = await fetch(`${BASE}/api/ocr/label`, { method: "POST", headers: { cookie: cookieHeader() }, body });
  const json = await response.json();
  check(
    "/api/ocr/label — прежний контракт { result }",
    response.status === 200 && json?.result?.productName === "Сметана 20%" && json.result.confidence === "high" && json.result.quantity === 0.4,
    JSON.stringify(json).slice(0, 160)
  );
}
check("после всех распознаваний временная папка пуста", listTmp().length === 0, `files=${listTmp().length}`);

// 5) Daily limits: 20 per user, 60 per organization (rolling 24 h, AuditLog).
{
  const used = Number((await db.query(`select count(*) from "AuditLog" where action='ai.vision_extract' and "entityId"=$1`, [user.id])).rows[0].count);
  for (let i = used; i < 20; i += 1) {
    await db.query(
      `insert into "AuditLog"(id, "organizationId", "userId", action, entity, "entityId", "createdAt") values ($1,$2,$3,'ai.vision_extract','ai_vision',$3, now() - interval '1 hour')`,
      [`test-vision-${i}`, orgId, user.id]
    );
  }
  let r = await extract("menu", [[menuPng, "photo-1.jpg", "image/png"]]);
  check("21-е распознавание сотрудника за сутки — 429", r.status === 429 && r.json?.code === "limit", `${r.status} ${r.json?.error}`);
  check("отказ по лимиту не оставил файлов", listTmp().length === 0, `files=${listTmp().length}`);
  // Older than 24 h does not count.
  await db.query(`update "AuditLog" set "createdAt" = now() - interval '25 hours' where action='ai.vision_extract' and "entityId"=$1`, [user.id]);
  await db.query(`delete from "AuditLog" where id like 'test-vision-%'`);
  for (let i = 0; i < 60; i += 1) {
    await db.query(
      `insert into "AuditLog"(id, "organizationId", "userId", action, entity, "entityId", "createdAt") values ($1,$2,null,'ai.vision_extract','ai_vision','someone-else', now() - interval '2 hours')`,
      [`test-vision-org-${i}`, orgId]
    );
  }
  r = await extract("menu", [[menuPng, "photo-1.jpg", "image/png"]]);
  check("организация выбрала 60 за сутки — 429 с текстом про организацию", r.status === 429 && /организации/.test(r.json?.error ?? ""), `${r.status} ${r.json?.error}`);
  await db.query(`delete from "AuditLog" where action = 'ai.vision_extract'`);
}

await db.end();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);

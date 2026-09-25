// Follow-up: /api/ocr/reading and /api/ai/check-photo on the dispatcher path (dev server :3042 + mock).
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";

const require = createRequire("C:/wt/qrforms/package.json");
const { Client } = require("pg");

const BASE = "http://localhost:3042";
const TMP = "C:/Users/Yaroslav/AppData/Local/Temp/18/wesetup-vision";
const EV = "C:/wt/qrforms/.agent/tasks/photo-recognize-2026-09/evidence";
const UPLOADS = "C:/wt/qrforms/public/uploads";
const MOCK = process.argv[2];
const env = Object.fromEntries(
  readFileSync("C:/wt/qrforms/.env", "utf8")
    .split(/\r?\n/)
    .map((line) => /^([A-Z_]+)=(.*)$/.exec(line.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"|"$/g, "")])
);
const originalMock = readFileSync(MOCK, "utf8");

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

async function login() {
  let response = await fetch(`${BASE}/api/auth/csrf`);
  remember(response);
  const { csrfToken } = await response.json();
  response = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
    body: new URLSearchParams({ csrfToken, email: "admin@haccp.local", password: env.ADMIN_PASSWORD, json: "true" }),
    redirect: "manual",
  });
  remember(response);
  response = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: cookieHeader() } });
  return (await response.json())?.user ?? null;
}

async function reading(bytes, type = "image/png", withCookie = true) {
  const body = new FormData();
  body.append("photo", new Blob([bytes], { type }), "display.png");
  const response = await fetch(`${BASE}/api/ocr/reading`, { method: "POST", headers: withCookie ? { cookie: cookieHeader() } : {}, body });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function checkPhoto(payload, withCookie = true) {
  const response = await fetch(`${BASE}/api/ai/check-photo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(withCookie ? { cookie: cookieHeader() } : {}) },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

const setMock = (patch) => writeFileSync(MOCK, JSON.stringify({ ...JSON.parse(originalMock), ...patch }));
const listTmp = () => (existsSync(TMP) ? readdirSync(TMP).filter((n) => /^[a-f0-9]{32}-(jpg|png|webp)$/.test(n)) : []);
const display = readFileSync(`${EV}/fu-display-readable.png`);
const food = readFileSync(`${EV}/ac1-menu-readable.png`);

const db = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/wesetup_wt_qrforms" });
await db.connect();
await db.query(`delete from "AuditLog" where action = 'ai.vision_extract'`);
mkdirSync(UPLOADS, { recursive: true });
const uploadName = `vision-e2e-${Date.now()}.png`;
writeFileSync(`${UPLOADS}/${uploadName}`, food);
writeFileSync(`${UPLOADS}/vision-e2e-anim.gif`, Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "binary"));

try {
  // ── /api/ocr/reading ──
  let r = await reading(display, "image/png", false);
  check("reading: без входа — 401", r.status === 401, `status=${r.status}`);
  const user = await login();
  check("вход admin@haccp.local", Boolean(user?.id));

  let seen = 0;
  const poll = setInterval(() => (seen = Math.max(seen, listTmp().length)), 150);
  r = await reading(display);
  clearInterval(poll);
  check(
    "reading: мок ```json → прежний контракт { value, unit, confidence }",
    r.status === 200 && r.json?.value === -18.5 && r.json?.unit === "C" && r.json?.confidence === "high" && Object.keys(r.json).length === 3,
    JSON.stringify(r.json)
  );
  check("reading: фото лежало во временной папке и удалено после ответа", seen === 1 && listTmp().length === 0, `максимум=${seen}, после=${listTmp().length}`);
  const audit = await db.query(
    `select details from "AuditLog" where action='ai.vision_extract' and "entityId"=$1 order by "createdAt" desc limit 1`,
    [user.id]
  );
  check("reading: запись в журнале действий (вид reading, 1 строка)", audit.rows[0]?.details?.visionKind === "reading" && audit.rows[0]?.details?.recognized === 1, JSON.stringify(audit.rows[0]?.details));

  setMock({ reading: '{"value":null,"unit":"C","confidence":"high"}' });
  r = await reading(display);
  check("reading: нечитаемо — value null, единица и уверенность не выдумываются", r.status === 200 && r.json?.value === null && r.json?.unit === null && r.json?.confidence === "low", JSON.stringify(r.json));

  setMock({ reading: '{"value":"−4,5","unit":"°C","confidence":"medium"}' });
  r = await reading(display);
  check("reading: строка «−4,5» → -4.5", r.status === 200 && r.json?.value === -4.5 && r.json?.unit === "C", JSON.stringify(r.json));

  setMock({ reading: "На фото дисплей, но я не уверен." });
  r = await reading(display);
  check("reading: ответ без JSON — 422 как раньше", r.status === 422 && /Не удалось разобрать ответ/.test(r.json?.error ?? ""), `${r.status} ${r.json?.error}`);

  setMock({ reading: "__timeout__" });
  r = await reading(display);
  check("reading: не успели — 504, «введите значение вручную»", r.status === 504 && /введите значение вручную/.test(r.json?.error ?? ""), `${r.status} ${r.json?.error}`);
  setMock({});

  r = await reading(Buffer.from("not an image"), "image/jpeg");
  check("reading: не картинка — 415", r.status === 415, `${r.status} ${r.json?.error}`);
  const big = Buffer.alloc(5 * 1024 * 1024 + 10, 0);
  big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
  r = await reading(big, "image/jpeg");
  check("reading: больше 5 МБ — 413", r.status === 413, `${r.status} ${r.json?.error}`);
  const empty = await fetch(`${BASE}/api/ocr/reading`, { method: "POST", headers: { cookie: cookieHeader() }, body: new FormData() });
  check("reading: без фото — 400", empty.status === 400, `status=${empty.status}`);
  check("reading: временная папка пуста", listTmp().length === 0, `files=${listTmp().length}`);

  // ── /api/ai/check-photo ──
  r = await checkPhoto({ imageUrl: `/uploads/${uploadName}`, expectedKind: "food" }, false);
  check("check-photo: без входа — 401", r.status === 401, `status=${r.status}`);
  r = await checkPhoto({ imageUrl: `/uploads/${uploadName}`, expectedKind: "food" });
  check(
    "check-photo: мок с текстом вокруг JSON → { valid, confidence, kind, reason }",
    r.status === 200 && r.json?.valid === true && r.json?.confidence === 0.92 && r.json?.kind === "food" && /тарелка супа/.test(r.json?.reason ?? "") && Object.keys(r.json).length === 4,
    JSON.stringify(r.json)
  );
  const audit2 = await db.query(
    `select details from "AuditLog" where action='ai.vision_extract' and "entityId"=$1 order by "createdAt" desc limit 1`,
    [user.id]
  );
  check("check-photo: запись в журнале действий (вид photo_check)", audit2.rows[0]?.details?.visionKind === "photo_check", JSON.stringify(audit2.rows[0]?.details));
  setMock({ photo_check: "Не могу оценить." });
  r = await checkPhoto({ imageUrl: `/uploads/${uploadName}`, expectedKind: "any" });
  check("check-photo: ответ без JSON — 502 { error, raw } как раньше", r.status === 502 && r.json?.error === "AI вернул некорректный JSON" && r.json?.raw === "Не могу оценить.", JSON.stringify(r.json));
  setMock({});
  r = await checkPhoto({ imageUrl: "https://169.254.169.254/latest/meta-data", expectedKind: "any" });
  check("check-photo: внешний URL — 400 (SSRF закрыт)", r.status === 400 && /uploads/.test(r.json?.error ?? ""), `${r.status} ${r.json?.error}`);
  r = await checkPhoto({ imageUrl: "/uploads/..%2F..%2F.env" });
  check("check-photo: обход каталога — 400", r.status === 400, `${r.status} ${r.json?.error}`);
  r = await checkPhoto({ imageUrl: "/uploads/missing-file.jpg" });
  check("check-photo: нет файла — 400 «Не удалось прочитать фото»", r.status === 400 && r.json?.error === "Не удалось прочитать фото", `${r.status} ${r.json?.error}`);
  r = await checkPhoto({ imageUrl: "/uploads/vision-e2e-anim.gif" });
  check("check-photo: GIF — 400 с понятным текстом", r.status === 400 && /JPG, PNG или WEBP/.test(r.json?.error ?? ""), `${r.status} ${r.json?.error}`);
  r = await checkPhoto("{not json");
  check("check-photo: битый JSON — 400", r.status === 400, `${r.status} ${r.json?.error}`);
  check("check-photo: временная папка пуста", listTmp().length === 0, `files=${listTmp().length}`);

  // ── Общие лимиты с «С фото»: 20 на сотрудника, 60 на организацию ──
  const org = (await db.query(`select "organizationId" from "User" where id=$1`, [user.id])).rows[0].organizationId;
  const used = Number((await db.query(`select count(*) from "AuditLog" where action='ai.vision_extract' and "entityId"=$1`, [user.id])).rows[0].count);
  for (let i = used; i < 20; i += 1) {
    await db.query(
      `insert into "AuditLog"(id, "organizationId", "userId", action, entity, "entityId", details, "createdAt") values ($1,$2,$3,'ai.vision_extract','ai_vision',$3,'{"visionKind":"menu"}', now() - interval '1 hour')`,
      [`fu-vision-${i}`, org, user.id]
    );
  }
  r = await reading(display);
  check("лимиты общие: 20 распознаваний «С фото»/этикеток/показаний → 21-е показание — 429", r.status === 429 && /20 в сутки на сотрудника/.test(r.json?.error ?? ""), `${r.status} ${r.json?.error}`);
  r = await checkPhoto({ imageUrl: `/uploads/${uploadName}`, expectedKind: "food" });
  check("лимиты общие: проверка фото тоже — 429", r.status === 429, `${r.status} ${r.json?.error}`);
  const extract = new FormData();
  extract.set("kind", "menu");
  extract.append("photo", new Blob([food], { type: "image/png" }), "m.png");
  const ex = await fetch(`${BASE}/api/ai/vision-extract`, { method: "POST", headers: { cookie: cookieHeader() }, body: extract });
  check("лимиты общие: «С фото» — тоже 429", ex.status === 429, `status=${ex.status}`);
  check("отказы по лимиту не оставили файлов", listTmp().length === 0, `files=${listTmp().length}`);
} finally {
  writeFileSync(MOCK, originalMock);
  await db.query(`delete from "AuditLog" where action = 'ai.vision_extract'`);
  await db.end();
  for (const name of [uploadName, "vision-e2e-anim.gif"]) {
    try {
      unlinkSync(`${UPLOADS}/${name}`);
    } catch {
      /* already gone */
    }
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);

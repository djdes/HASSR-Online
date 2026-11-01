// Подмена полей своего токена через NextAuth update (локальная wesetup_iso, prod-сборка на 3020).
// Руководитель точки А пишет в свою сессию partnerAccess / activeOrganizationId и
// пробует общий раздел компании (POST /api/products — закрыт ему proxy).
// node .agent/tasks/point-isolation-audit-2026-11-01/raw/token-forge.mjs <out-file>
import pg from "pg";

import { base, check, fx, save } from "./http-lib.mjs";

const out = process.argv[2] ?? "token-forge.txt";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_iso" });
await db.connect();

function jar() {
  const map = new Map();
  return {
    keep(res) {
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const at = pair.indexOf("=");
        map.set(pair.slice(0, at), pair.slice(at + 1));
      }
    },
    header: () => [...map].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}

async function signIn(email) {
  const cookies = jar();
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  cookies.keep(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies.header() },
    body: new URLSearchParams({ csrfToken, email, password: fx.password, json: "true" }),
  });
  cookies.keep(res);
  return cookies;
}

async function forge(cookies, data) {
  const csrfRes = await fetch(`${base}/api/auth/csrf`, { headers: { cookie: cookies.header() } });
  cookies.keep(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${base}/api/auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies.header() },
    body: JSON.stringify({ csrfToken, data }),
  });
  cookies.keep(res);
  // Ещё один запрос сессии: jwt-колбэк пересчитывает pointScope уже с подменой.
  const again = await fetch(`${base}/api/auth/session`, { headers: { cookie: cookies.header() } });
  cookies.keep(again);
  return again.json().catch(() => null);
}

async function tryCompanyWrite(cookies, label) {
  const name = `ВЗЛОМ продукт ${label} ${Date.now()}`;
  const res = await fetch(`${base}/api/products`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies.header() },
    body: JSON.stringify({ name }),
  });
  const row = (await db.query('select id from "Product" where name=$1', [name])).rows[0];
  if (row) await db.query('delete from "Product" where id=$1', [row.id]);
  return { status: res.status, created: Boolean(row) };
}

// Нужен свежий вход: подмена меняет cookie этой сессии.
const plain = await signIn(fx.users.headA.email);
const before = await tryCompanyWrite(plain, "до");
check("РТ А без подмены: POST /api/products — отказ (proxy)", before.status === 403 && !before.created, `HTTP ${before.status}`);

const partner = await signIn(fx.users.headA.email);
const sessionP = await forge(partner, { partnerAccess: { partnerId: "x", organizationId: fx.orgId, level: "edit" } });
const afterP = await tryCompanyWrite(partner, "partner");
check(
  "РТ А с подменой partnerAccess: POST /api/products — отказ",
  afterP.status === 403 && !afterP.created,
  `HTTP ${afterP.status} · создан: ${afterP.created} · сессия pointScope=${JSON.stringify(sessionP?.user?.pointScope ?? null)}`,
);

const foreign = await signIn(fx.users.headA.email);
const sessionO = await forge(foreign, { activeOrganizationId: fx.org2.orgId });
const afterO = await tryCompanyWrite(foreign, "org");
check(
  "РТ А с подменой activeOrganizationId: POST /api/products — отказ",
  afterO.status === 403 && !afterO.created,
  `HTTP ${afterO.status} · создан: ${afterO.created} · активная организация в сессии: ${sessionO?.user?.activeOrganizationId ?? "—"}`,
);
const leak = await fetch(`${base}/api/equipment`, { headers: { cookie: foreign.header() } });
const text = await leak.text();
check("РТ А с подменой activeOrganizationId: данные чужой организации не видны", !text.includes("ШХ Чужой"), `HTTP ${leak.status}`);

await db.end();
save(out);

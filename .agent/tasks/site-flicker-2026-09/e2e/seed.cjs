// Посев для замера морганий: своя организация, владелец с паролем, документ журнала.
// Запуск: node .agent/tasks/site-flicker-2026-09/e2e/seed.cjs [BASE]
// Пишет d:/wt/tmp-flicker/seed.json — его читает flicker-probe.cjs.
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const WT = "d:/wt/flicker";
const req = createRequire(path.join(WT, "package.json"));
const { Client } = req("pg");
const bcrypt = req("bcryptjs");

const BASE = process.argv[2] || "http://localhost:3197";
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_flicker?sslmode=disable";
const OUT_DIR = "d:/wt/tmp-flicker";
const RUN = Date.now().toString(36);
const OWNER = `flicker-owner-${RUN}@example.com`;
const PASSWORD = "Flicker2026!";
const ORG_NAME = "Кафе «Ромашка»";

async function sql(text, params = []) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(text, params)).rows;
  } finally {
    await c.end();
  }
}

function monthRange(d = new Date()) {
  const y = d.getFullYear();
  const m = d.getMonth();
  const pad = (n) => String(n).padStart(2, "0");
  const last = new Date(y, m + 1, 0).getDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
}

/**
 * Пул руководителей той же организации — для сценария «вход с формы»: вход ограничен
 * 5 попытками на почту за 5 минут, а замер входит десятки раз.
 */
async function addPool(seed, count = 24) {
  const [owner] = await sql('select "legalVersion" from "User" where id = $1', [seed.userId]);
  const hash = bcrypt.hashSync(seed.password, 10);
  const pool = [];
  for (let i = 1; i <= count; i++) {
    const id = `flk${seed.run}${String(i).padStart(2, "0")}`;
    const email = `flicker-${seed.run}-u${i}@example.com`;
    await sql(
      `insert into "User" (id, email, name, phone, "passwordHash", role, "organizationId", "journalAccessMigrated", "showWhatsNew", "legalVersion")
       values ($1,$2,$3,$4,$5,'manager',$6,true,false,$7) on conflict (id) do nothing`,
      [id, email, `Управляющий ${i}`, `+7999000${String(1000 + i)}`, hash, seed.orgId, owner.legalVersion],
    );
    pool.push({ id, email });
  }
  return pool;
}

async function main() {
  if (process.argv.includes("--pool")) {
    const seed = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "seed.json"), "utf8"));
    seed.pool = await addPool(seed);
    fs.writeFileSync(path.join(OUT_DIR, "seed.json"), JSON.stringify(seed, null, 2));
    console.log(`pool: ${seed.pool.length}`);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Мгновенная регистрация: новая организация + владелец + сессия (кука в ответе).
  const reg = await fetch(`${BASE}/api/auth/instant-register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: OWNER, consent: true }),
  });
  const regBody = await reg.json().catch(() => null);
  if (reg.status !== 200 || !regBody?.created) {
    throw new Error(`instant-register failed: ${reg.status} ${JSON.stringify(regBody)}`);
  }
  const cookieHeader = (reg.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  const [me] = await sql('select id, "organizationId" from "User" where email = $1', [OWNER]);
  const hash = bcrypt.hashSync(PASSWORD, 10);
  // Анкета заполнена (иначе поверх — «Завершите регистрацию»), пароль — для входа в замере.
  await sql('update "Organization" set name = $1 where id = $2', [ORG_NAME, me.organizationId]);
  await sql(
    'update "User" set name = $1, phone = $2, "passwordHash" = $3, "showWhatsNew" = false where id = $4',
    ["Анна Смирнова", "+79990001122", hash, me.id],
  );

  // Документ гигиенического журнала на текущий месяц — для перехода «журнал → документ».
  const templates = await sql(
    `select code from "JournalTemplate" where code in ('hygiene','health_check','cold_equipment_control','climate_control') order by code`,
  );
  const codes = templates.map((t) => t.code);
  const code = codes.includes("hygiene") ? "hygiene" : codes[0];
  if (!code) throw new Error("no journal templates in DB (seed.ts not run?)");
  const { from, to } = monthRange();
  const docRes = await fetch(`${BASE}/api/journal-documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ templateCode: code, dateFrom: from, dateTo: to }),
  });
  const docBody = await docRes.json().catch(() => null);
  const docId = docBody?.document?.id ?? docBody?.id ?? null;
  if (!docRes.ok || !docId) {
    throw new Error(`create document failed: ${docRes.status} ${JSON.stringify(docBody).slice(0, 400)}`);
  }
  const out = {
    run: RUN,
    base: BASE,
    owner: OWNER,
    password: PASSWORD,
    userId: me.id,
    orgId: me.organizationId,
    journalCode: code,
    docId,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUT_DIR, "seed.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

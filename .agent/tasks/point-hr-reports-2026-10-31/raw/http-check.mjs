// e2e-база (dev на порту 3025), не прод: выгрузка Excel, архив для проверки,
// потери и мониторинг — по точке из шапки. Нужен check.ts (данные выгрузки).
// node .agent/tasks/point-hr-reports-2026-10-31/raw/http-check.mjs
import { readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import pg from "pg";

const dir = ".agent/tasks/point-hr-reports-2026-10-31/raw";
const base = process.env.BASE_URL ?? "http://localhost:3025";
const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
const PASSWORD = "Verify-2026!";
const HEAD_A = "check-3110-head-a@verify.local";
const out = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
};

const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable";
const client = new pg.Client({ connectionString: DB });
await client.connect();
const q = async (sql, params = []) => (await client.query(sql, params)).rows;
const [A] = await q(`select id from "Building" where "organizationId"=$1 and name='Точка А'`, [seed.orgId]);
const [B] = await q(`select id from "Building" where "organizationId"=$1 and name='Точка Б'`, [seed.orgId]);
const areaOf = async (buildingId) => (await q(`select id from "Area" where "organizationId"=$1 and "buildingId"=$2 limit 1`, [seed.orgId, buildingId]))[0].id;
// Потери цехов точек А и Б.
await q(`delete from "LossRecord" where "organizationId"=$1 and "productName" like 'ПРОВЕРКА потерь%'`, [seed.orgId]);
for (const [point, name] of [[A.id, "ПРОВЕРКА потерь А"], [B.id, "ПРОВЕРКА потерь Б"]]) {
  await q(`insert into "LossRecord"(id,"organizationId",category,"productName",quantity,unit,"areaId") values ($1,$2,'spoilage',$3,1,'kg',$4)`, [
    `chk-loss-${point}`.slice(0, 25),
    seed.orgId,
    name,
    await areaOf(point),
  ]);
}

async function login(email, extraCookie = "") {
  const jar = new Map();
  const keep = (res) => {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const at = pair.indexOf("=");
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const cookie = () => [...[...jar].map(([k, v]) => `${k}=${v}`), extraCookie].filter(Boolean).join("; ");
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  keep(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password: PASSWORD, json: "true" }),
  });
  keep(res);
  if (![...jar.keys()].some((k) => k.includes("session-token"))) throw new Error(`вход не удался: ${email}`);
  return cookie();
}
const get = async (path, cookie) => {
  const res = await fetch(`${base}${path}`, { headers: { cookie } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res;
};
const excelRows = async (res) => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const rows = [];
  book.worksheets[0].eachRow((row) => rows.push(row.values.slice(1).map((v) => String(v ?? ""))));
  return rows;
};

// 1. Заведующая точки А.
{
  const cookie = await login(HEAD_A);
  const rows = await excelRows(await get("/api/reports/excel?templateCode=cold_equipment_control&from=2026-10-25&to=2026-10-25", cookie));
  const text = JSON.stringify(rows);
  check("Excel заведующей А: запись точки А есть", text.includes("маркер-Точка А"));
  check("Excel заведующей А: записи точки Б нет", !text.includes("маркер-Точка Б"));
  const zip = await JSZip.loadAsync(Buffer.from(await (await get("/api/reports/compliance-bundle?from=2026-10-25&to=2026-10-25", cookie)).arrayBuffer()));
  const manifestName = Object.keys(zip.files).find((name) => name.endsWith(".txt") && name.includes("ОТЧЁТ"));
  const manifest = manifestName ? await zip.file(manifestName).async("string") : "";
  check("архив заведующей А: в описи «Точка: Точка А»", manifest.includes("Точка: Точка А"));
  check("архив заведующей А: документа точки Б нет", !Object.keys(zip.files).some((name) => name.includes("Проверка выгрузки 31.10 · Точка Б")));
  check("архив заведующей А: документ точки А есть", Object.keys(zip.files).some((name) => name.includes("Проверка выгрузки 31.10 · Точка А")));
  const losses = await (await get("/losses", cookie)).text();
  check("потери заведующей А: свои есть", losses.includes("ПРОВЕРКА потерь А"));
  check("потери заведующей А: точки Б нет", !losses.includes("ПРОВЕРКА потерь Б"));
}

// 2. Руководство на всю сеть: «Вся организация» и выбранная в шапке точка Б.
{
  const cookie = await login(seed.manager, "wesetup.building=" + encodeURIComponent(`${seed.orgId}:organization`));
  const rows = await excelRows(await get("/api/reports/excel?templateCode=cold_equipment_control&from=2026-10-25&to=2026-10-25", cookie));
  const header = rows[0] ?? [];
  const rowB = rows.find((row) => row.join("|").includes("маркер-Точка Б")) ?? [];
  check("Excel «Вся организация»: колонка «Точка», строка точки Б подписана", header[1] === "Точка" && rowB[1] === "Точка Б", JSON.stringify(header));
  const monitoringAll = await (await get("/monitoring", cookie)).text();
  check("мониторинг «Вся организация»: выбрано «Все точки»", /aria-current="page"[^>]*>Все точки</.test(monitoringAll) || /aria-current="page"[^<]*Все точки/.test(monitoringAll));
  const cookieB = await login(seed.manager, "wesetup.building=" + encodeURIComponent(`${seed.orgId}:${B.id}`));
  const monitoringB = await (await get("/monitoring", cookieB)).text();
  check("мониторинг с точкой Б в шапке: открыт на точке Б", /aria-current="page"[^>]*>Точка Б</.test(monitoringB));
  const lossesB = await (await get("/losses", cookieB)).text();
  check("потери с точкой Б в шапке: точки А нет", lossesB.includes("ПРОВЕРКА потерь Б") && !lossesB.includes("ПРОВЕРКА потерь А"));
}

await client.end();
writeFileSync(`${dir}/http-check.txt`, out.join("\n") + "\n");
const failed = out.filter((line) => line.startsWith("FAIL")).length;
console.log(failed === 0 ? `ALL PASS (${out.length})` : `FAILED ${failed}/${out.length}`);
process.exit(failed === 0 ? 0 : 1);

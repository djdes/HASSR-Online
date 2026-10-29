/**
 * Локальные данные для проверки договора (ТОЛЬКО база wesetup_contract на 5432).
 * Запуск из корня worktree: node .agent/tasks/client-contract-2026-10-29/raw/seed-local.cjs
 *
 * - ROOT-пользователь root-contract@test.local / Test-12345 (пароль — хеш dk-owner);
 * - PlatformSetting legal.requisites: публичные данные ООО «БФС» + ЗАВЕДОМО ФЕЙКОВЫЙ банк;
 * - org-one: ООО с ИНН 7707083893, снимком ЕГРЮЛ и почтой бухгалтера;
 * - org-none: ИП с ИНН 500100732259 без снимка;
 * - .data/legal/facsimile.png и stamp.png — нарисованные тестовые картинки.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { createCanvas } = require("@napi-rs/canvas");

const DB = "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_contract";
if (!DB.includes("5432/wesetup_contract")) throw new Error("local DB only");

function facsimilePng() {
  const canvas = createCanvas(600, 200);
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#1d2a8a";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(40, 140);
  ctx.bezierCurveTo(120, 20, 170, 190, 240, 90);
  ctx.bezierCurveTo(300, 10, 330, 170, 400, 110);
  ctx.bezierCurveTo(450, 70, 500, 150, 560, 60);
  ctx.stroke();
  return canvas.toBuffer("image/png");
}

function stampPng() {
  const canvas = createCanvas(400, 400);
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "rgba(40, 60, 190, 0.8)";
  ctx.fillStyle = "rgba(40, 60, 190, 0.8)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(200, 200, 185, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(200, 200, 140, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = "bold 46px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("ТЕСТ", 200, 195);
  ctx.font = "bold 26px sans-serif";
  ctx.fillText("ОБРАЗЕЦ ПЕЧАТИ", 200, 240);
  return canvas.toBuffer("image/png");
}

(async () => {
  const legalDir = path.join(process.cwd(), ".data", "legal");
  fs.mkdirSync(legalDir, { recursive: true });
  fs.writeFileSync(path.join(legalDir, "facsimile.png"), facsimilePng());
  fs.writeFileSync(path.join(legalDir, "stamp.png"), stampPng());

  const c = new Client({ connectionString: DB });
  await c.connect();
  const requisites = {
    nameFull: "Общество с ограниченной ответственностью «БФС»",
    nameShort: "ООО «БФС»",
    inn: "5018215599",
    kpp: "501801001",
    ogrn: "1235000105306",
    address: "141065, Московская область, г. Королёв, ул. Ленина, д. 10/6",
    bank: { name: "АО «ТЕСТОВЫЙ БАНК» (фейк)", bik: "044500000", account: "40702810000000000001", corrAccount: "30101810000000000001" },
    head: { post: "Генеральный директор", name: "Волков Денис Владимирович" },
    vatMode: "none",
    email: "admin@wesetup.ru",
    phone: "+74951096543",
    facsimileFile: "facsimile.png",
    stampFile: "stamp.png",
    updatedAt: new Date().toISOString(),
  };
  await c.query(
    `insert into "PlatformSetting"(key, value, "updatedAt") values ('legal.requisites', $1, now())
     on conflict (key) do update set value = excluded.value, "updatedAt" = now()`,
    [JSON.stringify(requisites)],
  );

  const profile = {
    inn: "7707083893",
    type: "LEGAL",
    nameShort: "ООО «Доброе кафе»",
    nameFull: "Общество с ограниченной ответственностью «Доброе кафе»",
    opfShort: "ООО",
    opfFull: "Общество с ограниченной ответственностью",
    kpp: "773601001",
    ogrn: "1027700132195",
    ogrnDate: "2002-08-16",
    address: "117312, г Москва, ул Вавилова, д 19",
    management: { name: "СМИРНОВА АННА ПЕТРОВНА", post: "ГЕНЕРАЛЬНЫЙ ДИРЕКТОР" },
    okvedMain: { code: "56.10", name: "Деятельность ресторанов" },
    okvedsExtra: [],
    status: "ACTIVE",
    registrationDate: "2002-08-16",
    liquidationDate: null,
    employeeCount: 12,
    capital: null,
    branchCount: 0,
    finance: null,
    founders: [],
    phones: [],
    emails: ["info@dobroe-kafe.example"],
    fetchedAt: new Date().toISOString(),
  };
  await c.query(
    `update "Organization" set inn = '7707083893', "legalProfileJson" = $1, "legalProfileUpdatedAt" = now(),
       "accountantEmail" = 'buh@dobroe-kafe.example', phone = '+7 (900) 111-22-33' where id = 'org-one'`,
    [JSON.stringify(profile)],
  );
  await c.query(`update "Organization" set inn = '500100732259', "legalProfileJson" = null where id = 'org-none'`);

  const platform = await c.query(`select id from "Organization" where id = 'platform'`);
  if (!platform.rowCount) {
    await c.query(`insert into "Organization"(id, name, type, "createdAt", "updatedAt") values ('platform', 'WeSetup Platform', 'restaurant', now(), now())`);
  }
  const hash = (await c.query(`select "passwordHash" from "User" where email = 'dk-owner@test.local'`)).rows[0]?.passwordHash;
  if (!hash) throw new Error("dk-owner password hash not found");
  await c.query(
    `insert into "User"(id, email, name, role, "passwordHash", "organizationId", "isRoot", "isActive", "legalVersion", "createdAt")
     values ('u-root-contract', 'root-contract@test.local', 'Root Контракт', 'owner', $1, 'platform', true, true, '2026-09-30', now())
     on conflict (email) do update set "isRoot" = true, "passwordHash" = excluded."passwordHash", "legalVersion" = '2026-09-30'`,
    [hash],
  );
  console.log("seeded: ROOT root-contract@test.local / Test-12345, requisites, org-one (ООО), org-none (ИП)");
  await c.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

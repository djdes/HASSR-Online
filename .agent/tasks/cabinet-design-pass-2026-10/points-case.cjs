// Временные точки в ЛОКАЛЬНОЙ демо-базе wesetup_showcase для проверки центра
// шапки. Запуск: node points-case.cjs same|two-split|two-shared|clean
// Отказывается работать с любой другой базой (5433 — боевая).
const { Client } = require("D:/wt/sections-menu/node_modules/pg");
const fs = require("fs");
const env = fs.readFileSync("D:/wt/sections-menu/.env", "utf8");
const url = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)[1];
if (!/@localhost:5432\/wesetup_showcase/.test(url)) throw new Error("не демо-база");
const kase = process.argv[2];
const c = new Client({ connectionString: url.replace("?sslmode=disable", "") });
(async () => {
  await c.connect();
  const org = (await c.query(`select "organizationId" as id from "User" where email='admin@haccp.local'`)).rows[0].id;
  await c.query(`delete from "Building" where id like 'tmp-dp-%'`);
  await c.query(`update "Organization" set "perLocationJournals"=false where id=$1`, [org]);
  const add = (id, name, address, sort) =>
    c.query(`insert into "Building"(id,"organizationId",name,address,"sortOrder","createdAt","updatedAt") values($1,$2,$3,$4,$5,now(),now())`, [id, org, name, address, sort]);
  if (kase === "same" || kase.startsWith("two")) await add("tmp-dp-1", "Столовая «Берёзка»", "ул. Ленина, 5", 0);
  if (kase.startsWith("two")) await add("tmp-dp-2", "Цех на Мира", null, 1);
  if (kase === "two-split") await c.query(`update "Organization" set "perLocationJournals"=true where id=$1`, [org]);
  const rows = (await c.query(`select id,name,address from "Building" where "organizationId"=$1`, [org])).rows;
  const flag = (await c.query(`select "perLocationJournals" from "Organization" where id=$1`, [org])).rows[0];
  console.log(kase, JSON.stringify({ buildings: rows, ...flag }));
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

// Только локальная wesetup_integ: неполный тестовый профиль ЕГРЮЛ демо-организации
// сохраняется в raw/legal-profile-backup.json и обнуляется (как у организации без выписки).
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const URL = "postgresql://postgres:postgres@localhost:5432/wesetup_integ";
(async () => {
  const c = new Client({ connectionString: URL });
  await c.connect();
  const r = await c.query(`select o.id, o."legalProfileJson" as p from "Organization" o join "User" u on u."organizationId" = o.id where u.email = 'admin@haccp.local'`);
  fs.writeFileSync(path.join(__dirname, "raw", "legal-profile-backup.json"), JSON.stringify(r.rows, null, 2));
  const u = await c.query(`update "Organization" set "legalProfileJson" = null where id = $1`, [r.rows[0].id]);
  console.log("обнулено:", u.rowCount, "копия: raw/legal-profile-backup.json");
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

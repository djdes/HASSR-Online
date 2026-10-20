// Запрос к СВОЕЙ базе wesetup_pages_inspection (не прод). Использование: node db-query.cjs "SQL"
const fs = require("fs");
const path = require("path");
const env = fs.readFileSync(path.join(__dirname, "../../../.env"), "utf8");
const url = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)[1];
if (!url.includes("wesetup_pages_inspection") || url.includes(":5433")) throw new Error("not my db");
const { Client } = require("pg");
(async () => {
  const c = new Client({ connectionString: url.replace("?sslmode=disable", "") });
  await c.connect();
  const r = await c.query(process.argv[2]);
  console.log(JSON.stringify(r.rows, null, 1));
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

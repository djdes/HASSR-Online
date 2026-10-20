// Проверка паролей демо-пользователей в СВОЕЙ базе (wesetup_pages_inspection).
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const env = fs.readFileSync(path.join(__dirname, "../../../.env"), "utf8");
const url = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)[1];
if (!url.includes("wesetup_pages_inspection") || url.includes(":5433")) throw new Error("not my db");
(async () => {
  const c = new Client({ connectionString: url.replace("?sslmode=disable", "") });
  await c.connect();
  const r = await c.query(`select email, "passwordHash" from "User" where email in ('admin@haccp.local','chef@haccp.local','hotcook1@haccp.local')`);
  for (const row of r.rows) console.log(row.email, row.passwordHash ? bcrypt.compareSync("admin1234", row.passwordHash) : "no hash");
  await c.end();
})();

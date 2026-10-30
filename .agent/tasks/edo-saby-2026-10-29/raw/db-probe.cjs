// Смотрит локальную БД wesetup_edo (НЕ прод): ROOT-пользователи, реквизиты, организации с ИНН.
const { Client } = require("pg");

(async () => {
  const c = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_edo" });
  await c.connect();
  const roots = await c.query(`SELECT id, email, "isRoot", "organizationId", "legalVersion" FROM "User" WHERE "isRoot" = true LIMIT 5`);
  console.log("roots", roots.rows);
  const req = await c.query(`SELECT key, left(value, 300) AS value FROM "PlatformSetting" WHERE key = 'legal.requisites'`);
  console.log("requisites", req.rows);
  const orgs = await c.query(`SELECT id, name, inn, kpp, "isDemo" FROM "Organization" WHERE inn IS NOT NULL LIMIT 5`);
  console.log("orgs", orgs.rows);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

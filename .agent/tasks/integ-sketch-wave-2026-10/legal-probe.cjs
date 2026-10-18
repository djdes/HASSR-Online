// Только чтение локальной wesetup_integ: форма legalProfileJson у организаций.
const { Client } = require("pg");
(async () => {
  const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/wesetup_integ" });
  await c.connect();
  const r = await c.query(`select o.id, o.name, o."legalProfileJson" as p, o."legalProfileUpdatedAt" as at from "Organization" o join "User" u on u."organizationId" = o.id where u.email = 'admin@haccp.local'`);
  for (const row of r.rows) {
    const p = row.p;
    console.log(row.name, row.at, p === null ? "null" : typeof p, p ? Object.keys(p).join(",") : "");
    if (p) console.log("okvedsExtra:", Array.isArray(p.okvedsExtra), "founders:", Array.isArray(p.founders));
  }
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

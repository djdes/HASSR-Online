// Документы журналов по точкам для проверки хаба точки (только локальная wesetup_pscope).
const { Client } = require("pg");
const ids = require("./ids.json");
(async () => {
  const c = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_pscope" });
  await c.connect();
  await c.query(`DELETE FROM "JournalDocument" WHERE "organizationId" = $1`, [ids.org]);
  const add = async (code, buildingId, title) => {
    const t = await c.query(`SELECT id FROM "JournalTemplate" WHERE code = $1`, [code]);
    await c.query(
      `INSERT INTO "JournalDocument" (id, "templateId", "organizationId", title, "dateFrom", "dateTo", status, "buildingId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, date_trunc('month', now()), date_trunc('month', now()) + interval '1 month - 1 day', 'active', $5, now(), now())`,
      [`e2e-${code}-${buildingId}`, t.rows[0].id, ids.org, title, buildingId]
    );
  };
  await add("incoming_control", ids.garden, "Приёмка — сад");
  await add("finished_product", ids.school, "Бракераж — гимназия");
  console.log("ok");
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

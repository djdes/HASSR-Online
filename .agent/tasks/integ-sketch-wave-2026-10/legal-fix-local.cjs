// Только локальная wesetup_integ: тестовый профиль ЕГРЮЛ без okvedsExtra/founders
// дополняется пустыми списками (в настоящих профилях DaData они есть всегда).
const { Client } = require("pg");
const URL = "postgresql://postgres:postgres@localhost:5432/wesetup_integ";
(async () => {
  if (!URL.includes("localhost:5432/wesetup_integ")) throw new Error("не та база");
  const c = new Client({ connectionString: URL });
  await c.connect();
  const r = await c.query(`update "Organization" set "legalProfileJson" = "legalProfileJson"
      || jsonb_build_object('okvedsExtra', coalesce("legalProfileJson"->'okvedsExtra', '[]'::jsonb),
                            'founders', coalesce("legalProfileJson"->'founders', '[]'::jsonb))
    where "legalProfileJson" is not null and jsonb_typeof("legalProfileJson") = 'object'
      and ("legalProfileJson"->'okvedsExtra' is null or "legalProfileJson"->'founders' is null)
    returning id, name`);
  console.log("обновлено:", r.rowCount, r.rows.map((x) => x.name).join(", "));
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

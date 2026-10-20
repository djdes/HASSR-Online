// Только чтение wesetup_integ: строки выгрузки мастер-кабинета в журналах пищеблоков.
const { Client } = require("pg");
(async () => {
  const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/wesetup_integ" });
  await c.connect();
  const r = await c.query(`select o.name, d.title, jsonb_array_length(coalesce(d.config->'rows','[]'::jsonb)) as rows,
      (select count(*) from jsonb_array_elements(coalesce(d.config->'rows','[]'::jsonb)) e where e->>'productName' in ('Борщ со сметаной','Компот из сухофруктов'))::int as smoke_rows
    from "JournalDocument" d join "Organization" o on o.id = d."organizationId" join "JournalTemplate" t on t.id = d."templateId"
    where t.code = 'finished_product' and o.id in ('cmvbfyemt0000uw9mywdjiurr','fx-org-single') order by o.name`);
  for (const row of r.rows) console.log(JSON.stringify(row));
  const b = await c.query(`select count(*)::int as n from "MasterBrakerageBatch" where "organizationId" = 'mx-cabinet'`);
  console.log("batches", b.rows[0].n);
  await c.end();
})();

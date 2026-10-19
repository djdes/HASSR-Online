/**
 * Досмотр AC8 после api-smoke.ts: в первом прогоне страница наклейки
 * открывалась с `?t=` вместо `?token=` (ошибка смоук-скрипта, не
 * приложения) — эти две проверки повторены здесь с верной ссылкой.
 *
 *   npx tsx .agent/tasks/points-model-2026-10/raw/api-smoke-pages.ts http://localhost:3042
 */
import "dotenv/config";
import pg from "pg";

import { mintEquipmentQrToken } from "@/lib/equipment-qr-token";

const BASE = process.argv[2] ?? "http://localhost:3042";
const ORG = "cmvbfyemt0000uw9mywdjiurr";
const sql = new pg.Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/wesetup_points" });
let failed = 0;
function check(name: string, ok: boolean, detail: unknown) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${JSON.stringify(detail)}`);
}

async function main() {
  await sql.connect();
  const fryer = (await sql.query(`SELECT id FROM "Equipment" WHERE name = 'Фритюрница 8л'`)).rows[0] as { id: string };
  const url = `${BASE}/equipment-fill/${encodeURIComponent(fryer.id)}?token=${encodeURIComponent(mintEquipmentQrToken(fryer.id))}`;
  console.log(`INFO fryerUrl=${url}`);

  const res = await fetch(url);
  const html = await res.text();
  check(
    "AC8 GET /equipment-fill/[id] фритюрницы: форма журнала фритюрных жиров, не форма температуры",
    // Сообщения namespace equipmentFill целиком уходят в RSC-payload (там
    // есть и «Температура холодильного оборудования»), поэтому проверяем
    // отрисованную разметку: заголовок h1 и блок оценки жира.
    res.status === 200 &&
      /<h1[^>]*>[^<]*фритюрных жиров/.test(html) &&
      html.includes('data-testid="fryer-quality"') &&
      !/<h1[^>]*>[^<]*Температура/.test(html),
    {
      status: res.status,
      h1: (html.match(/<h1[^>]*>([^<]*)<\/h1>/) ?? [])[1] ?? null,
      form: html.includes('data-testid="fryer-quality"'),
    },
  );

  const active = (
    await sql.query(
      `SELECT d.id FROM "JournalDocument" d JOIN "JournalTemplate" t ON t.id = d."templateId"
        WHERE d."organizationId" = $1 AND t.code = 'fryer_oil' AND d.status = 'active'`,
      [ORG],
    )
  ).rows.map((row) => row.id as string);
  await sql.query(`UPDATE "JournalDocument" SET status = 'closed' WHERE id = ANY($1)`, [active]);
  try {
    const noDoc = await fetch(url);
    const noDocHtml = await noDoc.text();
    check(
      "AC8 нет активного документа: жёлтая плашка до ввода, форма записи не показана",
      noDoc.status === 200 &&
        noDocHtml.includes("не входит ни в один активный журнал") &&
        noDocHtml.includes('data-testid="fryer-no-document"') &&
        !noDocHtml.includes('data-testid="fryer-save"'),
      { status: noDoc.status },
    );
  } finally {
    await sql.query(`UPDATE "JournalDocument" SET status = 'active' WHERE id = ANY($1)`, [active]);
  }
  console.log(`SUMMARY ${failed === 0 ? "PASS" : "FAIL"} failed=${failed}`);
  await sql.end();
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await sql.end().catch(() => undefined);
  process.exit(1);
});

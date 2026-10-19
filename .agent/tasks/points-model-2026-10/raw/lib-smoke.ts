/**
 * AC3 (последний пункт): ensureDefaultArea ставит точку, когда она одна;
 * при двух точках — без точки. Плюс деплойный prisma/seed-mirror-rooms-to-areas.ts
 * создаёт цех-зеркало сразу с точкой помещения. Только локальная копия.
 *
 *   npx tsx .agent/tasks/points-model-2026-10/raw/lib-smoke.ts
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import pg from "pg";

if (!/localhost:5432\/wesetup_points/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("DATABASE_URL must point at the local wesetup_points copy");
}

const sql = new pg.Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/wesetup_points" });
let failed = 0;
function check(name: string, ok: boolean, detail: unknown) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${JSON.stringify(detail)}`);
}

async function main() {
  await sql.connect();
  const { ensureDefaultArea } = await import("@/lib/equipment-directory");
  const { soleBuildingId } = await import("@/lib/area-building-sync");

  // Организация с одной точкой и без цехов.
  await sql.query(
    `INSERT INTO "Organization" (id, name, type, "updatedAt") VALUES ('fx-org-default', 'Пекарня «Первый цех»', 'bakery', now()) ON CONFLICT (id) DO NOTHING`,
  );
  await sql.query(
    `INSERT INTO "Building" (id, "organizationId", name, "sortOrder", "updatedAt") VALUES ('fx-building-default', 'fx-org-default', 'Пекарня', 0, now()) ON CONFLICT (id) DO NOTHING`,
  );
  await sql.query(`DELETE FROM "Area" WHERE "organizationId" = 'fx-org-default'`);
  const areaId = await ensureDefaultArea("fx-org-default");
  const area = (await sql.query(`SELECT name, "buildingId" FROM "Area" WHERE id = $1`, [areaId])).rows[0];
  check("AC3 ensureDefaultArea: точка одна — цех в ней", area?.buildingId === "fx-building-default", area);

  check(
    "AC3 soleBuildingId: одна точка → она, две → null, нет → null",
    (await soleBuildingId("fx-org-default")) === "fx-building-default" &&
      (await soleBuildingId("cmvbfyemt0000uw9mywdjiurr")) === null &&
      (await soleBuildingId("fx-org-none")) === null,
    "ok",
  );

  // Деплойный зеркальный сид: помещение без цеха → цех с точкой помещения.
  await sql.query(
    `INSERT INTO "Room" (id, "buildingId", name, kind, "updatedAt") VALUES ('fx-r-single-cold', 'fx-building-single', 'Холодная заготовка', 'kitchen', now()) ON CONFLICT (id) DO NOTHING`,
  );
  const out = execSync("npx tsx prisma/seed-mirror-rooms-to-areas.ts", { encoding: "utf8", env: process.env });
  const mirror = (
    await sql.query(`SELECT "buildingId" FROM "Area" WHERE "organizationId" = 'fx-org-single' AND name = 'Холодная заготовка'`)
  ).rows;
  check(
    "seed-mirror-rooms-to-areas: новый цех-зеркало сразу с точкой помещения",
    mirror.length === 1 && mirror[0].buildingId === "fx-building-single",
    { out: out.trim(), mirror },
  );

  console.log(`SUMMARY ${failed === 0 ? "PASS" : "FAIL"} failed=${failed}`);
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await sql.end().catch(() => undefined);
  process.exit(1);
});

// Фикстура «как до 2026-10-17» на копии демо-базы (wesetup_points):
// точки и помещения есть, а у цехов точки нет (Area.buildingId = null).
// Нужна, чтобы backfill-area-building.ts прошёл все ветки правила.
// Только локальная база: адрес зашит, порт 5432 (НЕ 5433 — это прод).
// Идемпотентно: фиксированные id + ON CONFLICT DO NOTHING.
//
//   node .agent/tasks/points-model-2026-10/raw/seed-legacy-fixture.cjs
const path = require("node:path");
const pg = require(path.resolve(__dirname, "../../../../node_modules/pg"));

const URL = "postgresql://postgres:postgres@localhost:5432/wesetup_points";
const ORG = "cmvbfyemt0000uw9mywdjiurr"; // Столовая «Берёзка» из демо-сида

const B1 = "fx-building-lenina";
const B2 = "fx-building-mira";
const ORG_SINGLE = "fx-org-single";
const B_SINGLE = "fx-building-single";
const ORG_NONE = "fx-org-none";

async function main() {
  const c = new pg.Client({ connectionString: URL });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);
  try {
    await q("BEGIN");
    // Берёзка: две точки, переключатель точек в шапке включён.
    await q(`UPDATE "Organization" SET "perLocationJournals" = true WHERE id = $1`, [ORG]);
    await q(
      `INSERT INTO "Building" (id, "organizationId", name, address, "sortOrder", "updatedAt") VALUES
        ($1, $3, 'Берёзка на Ленина', 'ул. Ленина, 5', 0, now()),
        ($2, $3, 'Берёзка на Мира', 'пр. Мира, 12', 1, now())
       ON CONFLICT (id) DO NOTHING`,
      [B1, B2, ORG],
    );
    const rooms = [
      // точка 1 — одноимённые цехам помещения
      ["fx-r-hot", B1, "Горячий цех", "kitchen"],
      ["fx-r-cold", B1, "холодный  ЦЕХ", "kitchen"], // регистр и пробелы не важны
      ["fx-r-store", B1, "Склад", "storage"],
      ["fx-r-bar", B1, "Бар", "bar"],
      ["fx-r-hall", B1, "Зал", "guest"],
      ["fx-r-serve", B1, "Раздача", "other"],
      ["fx-r-wash1", B1, "Мойка", "wash"],
      // точка 2
      ["fx-r-pastry", B2, "Кондитерский цех", "kitchen"],
      ["fx-r-pack", B2, "Упаковка", "other"],
      ["fx-r-wash2", B2, "Мойка", "wash"], // «Мойка» в двух точках — неоднозначно
      ["fx-r-prod", B2, "Основное производство", "production"], // помещение без цеха
    ];
    for (const [id, buildingId, name, kind] of rooms) {
      await q(
        `INSERT INTO "Room" (id, "buildingId", name, kind, "updatedAt") VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (id) DO NOTHING`,
        [id, buildingId, name, kind],
      );
    }
    // «Холодильный цех» — помещения нет нигде, точек две → no-match.

    // Организация с одной точкой: все её цеха без точки уходят в неё.
    await q(
      `INSERT INTO "Organization" (id, name, type, "updatedAt") VALUES ($1, 'Кафе «Одна точка»', 'restaurant', now())
       ON CONFLICT (id) DO NOTHING`,
      [ORG_SINGLE],
    );
    await q(
      `INSERT INTO "Building" (id, "organizationId", name, "sortOrder", "updatedAt") VALUES ($1, $2, 'Основная точка', 0, now())
       ON CONFLICT (id) DO NOTHING`,
      [B_SINGLE, ORG_SINGLE],
    );
    await q(
      `INSERT INTO "Room" (id, "buildingId", name, kind, "updatedAt") VALUES ('fx-r-single-kitchen', $1, 'Кухня', 'kitchen', now())
       ON CONFLICT (id) DO NOTHING`,
      [B_SINGLE],
    );
    await q(
      `INSERT INTO "Area" (id, name, "organizationId") VALUES
        ('fx-a-single-kitchen', 'Кухня', $1),
        ('fx-a-single-back', 'Подсобка', $1)
       ON CONFLICT (id) DO NOTHING`,
      [ORG_SINGLE],
    );

    // Организация без точек: цех остаётся без точки.
    await q(
      `INSERT INTO "Organization" (id, name, type, "updatedAt") VALUES ($1, 'Цех «Без точек»', 'production', now())
       ON CONFLICT (id) DO NOTHING`,
      [ORG_NONE],
    );
    await q(
      `INSERT INTO "Area" (id, name, "organizationId") VALUES ('fx-a-none', 'Цех', $1)
       ON CONFLICT (id) DO NOTHING`,
      [ORG_NONE],
    );
    await q("COMMIT");
  } catch (error) {
    await q("ROLLBACK");
    throw error;
  }
  const summary = await q(
    `SELECT o.name AS org,
            (SELECT count(*) FROM "Building" b WHERE b."organizationId" = o.id) AS buildings,
            (SELECT count(*) FROM "Room" r JOIN "Building" b ON b.id = r."buildingId" WHERE b."organizationId" = o.id) AS rooms,
            (SELECT count(*) FROM "Area" a WHERE a."organizationId" = o.id) AS areas,
            (SELECT count(*) FROM "Area" a WHERE a."organizationId" = o.id AND a."buildingId" IS NULL) AS areas_without_building
       FROM "Organization" o ORDER BY o.name`,
  );
  console.table(summary.rows);
  await c.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

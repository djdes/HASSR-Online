/**
 * Сброс стенда перед повторным замером UI (не для прода): снимает скрепки и
 * избранное владельца, возвращает светлую тему профиля и снова «теряет»
 * холодильник в документе журнала холодильников — строка ссылается на
 * оборудование, которого нет в справочнике (как на скриншоте 1 владельца).
 * Запуск: npx tsx .agent/tasks/office-objects-favorites-2026-11-23/raw/stand-reset.ts
 */
import "dotenv/config";
import { db } from "../../../../src/lib/db";

type ColdRow = { id: string; name: string; sourceEquipmentId?: string | null };

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("stand only");
  const org = await db.organization.findFirst({ where: { name: "Стенд: Кафе «Берёзка»" }, select: { id: true } });
  if (!org) throw new Error("stand not found: run stand-seed.ts first");
  await db.user.update({
    where: { email: "owner@stand.local" },
    data: { pinnedBuildingIds: [], homeFavorites: [], themePreference: "light" },
  });
  const cold = await db.journalDocument.findFirst({
    where: { organizationId: org.id, title: "Журнал холодильников (создан в офисе)" },
    select: { id: true, config: true },
  });
  if (!cold) throw new Error("cold equipment document not found");
  const config = (cold.config ?? {}) as { equipment?: ColdRow[] };
  const equipment = (config.equipment ?? []).map((row) =>
    row.id === "cold-equipment-stand-1" ? { ...row, sourceEquipmentId: "deleted-equipment-id" } : row,
  );
  await db.journalDocument.update({ where: { id: cold.id }, data: { config: { ...config, equipment } } });
  console.log(JSON.stringify({ org: org.id, coldDocument: cold.id, rows: equipment.map((row) => `${row.name}:${row.sourceEquipmentId}`) }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

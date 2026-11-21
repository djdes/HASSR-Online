/**
 * One-shot (владелец, 2026-11-21: «запушь в прод через воркфлоу… чтобы мне не
 * пришлось команды вводить»): снять унаследованный фирменный стиль у
 * организаций, созданных «как текущая» до исправления (#295), — то же, что
 * `npx tsx scripts/repair-inherited-org-brand.ts --apply`. Что считается
 * унаследованным — `src/lib/inherited-org-brand.ts`: логотип и основной цвет,
 * которые в организации никто не задавал и которые повторяют более старую
 * организацию того же аккаунта. Убранное — в журнале действий каждой
 * организации (`organization.brand.inherited_removed`, с прежними значениями).
 *
 * Ключ `once:inherited-org-brand:v1`: второй раз не запускается. Лог Actions
 * публичный — в лог только счётчики и id организаций, без названий.
 *
 * Запуск: npx tsx prisma/seed-repair-inherited-org-brand-2026-11.ts [--dry-run]
 * На деплое — см. .github/workflows/deploy.yml.
 */
import "dotenv/config";

import { db } from "../src/lib/db";
import { findInheritedBrandInDb, removeInheritedBrand } from "../src/lib/inherited-org-brand.server";

const DRY_RUN = process.argv.includes("--dry-run");
const TAG = DRY_RUN ? "[inherited-brand:dry-run]" : "[inherited-brand]";
const ONCE_KEY = "once:inherited-org-brand:v1";

async function main() {
  if (await db.platformSetting.findUnique({ where: { key: ONCE_KEY } })) {
    console.log(`${TAG} ${ONCE_KEY}: already done`);
    return;
  }

  const { checked, fixes } = await findInheritedBrandInDb();
  const logos = fixes.filter((fix) => fix.logo).length;
  const colours = fixes.filter((fix) => fix.brandColor).length;

  for (const fix of fixes) {
    console.log(`${TAG} ${fix.organizationId}: ${[fix.logo ? `logo ${fix.logo}` : null, fix.brandColor ? "colour" : null].filter(Boolean).join(", ")}`);
    if (!DRY_RUN) await removeInheritedBrand(fix, "deploy: once:inherited-org-brand:v1");
  }
  // Итог — последней строкой: на выкладке лог обрезается `tail`.
  console.log(
    `${TAG} checked ${checked} organizations in multi-organization accounts; ` +
      `${DRY_RUN ? "would remove" : "removed"} inherited brand: ${fixes.length} (logo ${logos}, colour ${colours})`,
  );

  if (!DRY_RUN) {
    await db.platformSetting.create({
      data: {
        key: ONCE_KEY,
        value: JSON.stringify({ at: new Date().toISOString(), checked, removed: fixes.length, logos, colours }),
      },
    });
    console.log(`${TAG} done`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

/**
 * One-shot (владелец, 2026-11-21: «запушь в прод через воркфлоу… чтобы мне не
 * пришлось команды вводить»): снять унаследованный фирменный стиль у
 * организаций, созданных «как текущая» до исправления (#295), — то же, что
 * `npx tsx scripts/repair-inherited-org-brand.ts --apply`. Что считается
 * унаследованным — `src/lib/inherited-org-brand.ts`: логотип и основной цвет,
 * которые в организации никто не задавал и которые повторяют более старую
 * организацию того же аккаунта, и адрес файла другой организации у любой.
 * Убранное — в журнале действий каждой организации
 * (`organization.brand.inherited_removed`, с прежними значениями).
 *
 * v1 (выкладка #296) проверил 18 организаций аккаунтов с несколькими
 * организациями и не нашёл ничего: правила были уже. v2 — все организации,
 * своя копия файла без записи о загрузке (пока журнал хранит все загрузки),
 * и перед починкой — обезличенная перепись логотипов (`brandCensus`): видно,
 * остался ли где-то чужой логотип.
 *
 * Ключ `once:inherited-org-brand:v2`: второй раз не запускается. Лог Actions
 * публичный — в лог только счётчики и id организаций, без названий.
 *
 * Запуск: npx tsx prisma/seed-repair-inherited-org-brand-2026-11.ts [--dry-run]
 * На деплое — см. .github/workflows/deploy.yml.
 */
import "dotenv/config";

import { db } from "../src/lib/db";
import { brandCensus } from "../src/lib/inherited-org-brand";
import { findInheritedBrandInDb, removeInheritedBrand } from "../src/lib/inherited-org-brand.server";

const DRY_RUN = process.argv.includes("--dry-run");
const TAG = DRY_RUN ? "[inherited-brand:dry-run]" : "[inherited-brand]";
const ONCE_KEY = "once:inherited-org-brand:v2";

async function main() {
  if (await db.platformSetting.findUnique({ where: { key: ONCE_KEY } })) {
    console.log(`${TAG} ${ONCE_KEY}: already done`);
    return;
  }

  const { checked, rows, fixes } = await findInheritedBrandInDb();

  // Перепись — до починки: как было на проде.
  const census = brandCensus(rows);
  const ids = (list: string[]) => (list.length ? list.join(" ") : "—");
  console.log(
    `${TAG} census: organizations ${census.organizations}, with logo ${census.withLogo} ` +
      `(own files ${census.ownFiles}, external links ${census.externalLinks}, other organization's file ${census.foreignPointers.length})`,
  );
  console.log(`${TAG} census: other organization's file: ${ids(census.foreignPointers)}`);
  console.log(`${TAG} census: own file never uploaded here: ${ids(census.filesWithoutUpload)}`);
  for (const group of census.sameFileGroups) {
    console.log(`${TAG} census: same file in ${group.ids.length} (same account ${group.sameAccount}, uploaded by a person ${group.uploaded}): ${group.ids.join(" ")}`);
  }
  for (const group of census.sameLinkGroups) {
    console.log(`${TAG} census: same link in ${group.ids.length} (same account ${group.sameAccount}): ${group.ids.join(" ")}`);
  }

  const logos = fixes.filter((fix) => fix.logo).length;
  const colours = fixes.filter((fix) => fix.brandColor).length;
  for (const fix of fixes) {
    console.log(`${TAG} ${fix.organizationId}: ${[fix.logo ? `logo ${fix.logo}` : null, fix.brandColor ? "colour" : null].filter(Boolean).join(", ")}`);
    if (!DRY_RUN) await removeInheritedBrand(fix, "deploy: once:inherited-org-brand:v2");
  }
  // Итог — последней строкой: на выкладке лог обрезается `tail`.
  console.log(
    `${TAG} checked ${checked} organizations; ` +
      `${DRY_RUN ? "would remove" : "removed"} inherited brand: ${fixes.length} (logo ${logos}, colour ${colours})`,
  );

  if (!DRY_RUN) {
    await db.platformSetting.create({
      data: {
        key: ONCE_KEY,
        value: JSON.stringify({
          at: new Date().toISOString(),
          checked,
          removed: fixes.length,
          logos,
          colours,
          census: {
            withLogo: census.withLogo,
            ownFiles: census.ownFiles,
            foreignPointers: census.foreignPointers.length,
            filesWithoutUpload: census.filesWithoutUpload.length,
            sameFileGroups: census.sameFileGroups.length,
            sameLinkGroups: census.sameLinkGroups.length,
          },
        }),
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

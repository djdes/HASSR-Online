/**
 * One-shot (владелец, 2026-11-24): «"Выделить офис" убери и сделай по
 * умолчанию всем с офисом, организации у которых не выделено открой».
 * Каждой обычной организации с объектами открывается офис — то, что делала
 * кнопка «Выделить офис»: здание офиса (если его нет) и журналы по объектам;
 * руководители, закреплённые за объектами, входят заново (их доступ сужается
 * до своих объектов). Платформа, мастер-кабинеты справочников и организации
 * без объектов не трогаются: у них офис откроется вместе с первым объектом.
 * Каждое открытие — в журнал действий организации (`building.office_opened`:
 * id офиса, создан ли, какими были журналы до открытия) — его можно вернуть.
 * Уже заполненные документы остаются общими и видны на объектах.
 *
 * Выкладка запускает сначала `--dry-run` (подсчёт), затем открытие — после
 * проверки новой сборки, как перенос журналов офиса. Ключ
 * `once:open-office:v1`: второй раз не запускается. Лог Actions публичный —
 * в лог только итоги, без id и названий.
 *
 * Запуск: npx tsx prisma/seed-open-office-2026-11.ts [--dry-run]
 */
import "dotenv/config";

import { db } from "../src/lib/db";
import { openOfficesForAllOrganizations } from "../src/lib/organization-office.server";

const DRY_RUN = process.argv.includes("--dry-run");
const TAG = DRY_RUN ? "[open-office:dry-run]" : "[open-office]";
const ONCE_KEY = "once:open-office:v1";

async function main() {
  if (await db.platformSetting.findUnique({ where: { key: ONCE_KEY } })) {
    console.log(`${TAG} ${ONCE_KEY}: already done`);
    return;
  }
  const totals = await openOfficesForAllOrganizations({ dryRun: DRY_RUN });
  // Итог — одной строкой и последней: на выкладке лог обрезается `tail`.
  console.log(
    `${TAG} organizations ${DRY_RUN ? "to open" : "opened"} ${totals.organizations}; ` +
      `offices ${DRY_RUN ? "to create" : "created"} ${totals.officesCreated}; ` +
      `journals by objects ${DRY_RUN ? "to enable" : "enabled"} ${totals.splitEnabled}` +
      (DRY_RUN ? "" : `; manager sessions closed ${totals.sessionsClosed}`),
  );
  if (!DRY_RUN) {
    await db.platformSetting.create({
      data: { key: ONCE_KEY, value: JSON.stringify({ at: new Date().toISOString(), ...totals }) },
    });
  }
}

main()
  .catch((error) => {
    console.error(`${TAG} failed:`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });

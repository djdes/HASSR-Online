/**
 * One-shot (владелец, 2026-11-23): «Мы не считаем офис за объект… Если журнал
 * в офисе уже создан и там не указан объект, то привязывать к единственному
 * созданному или первому по списку объекту». Документы электронных и бумажных
 * журналов, привязанные к офису, переходят на единственный объект организации,
 * а если объектов несколько — на первый по списку (порядок объектов, затем
 * название). Не переносятся (`planOfficeJournalMoves`, ревью 2026-11-24):
 * копии, у которых на объекте уже есть документ того же журнала за
 * пересекающийся период (автоматика раньше заводила копию и офису), и журналы,
 * выключенные на объекте. Организации без объектов не трогаются. Каждый
 * перенос — в журнал действий организации (`journals.office_to_point`) с id
 * перенесённых и оставленных документов: его можно вернуть. Новые документы
 * на офис больше не создаются: окно создания и API требуют объект, автоматика
 * раздаёт документы только объектам.
 *
 * Выкладка (решение владельца 2026-11-24: «Переносить при выкладке, дубли
 * оставить на офисе») запускает сначала `--dry-run` (подсчёт), затем перенос —
 * как разовую починку фирменного стиля 2026-11-21. Ключ
 * `once:office-journals-to-points:v1`: второй раз не запускается. Лог Actions
 * публичный — в лог только итоги, без id и названий.
 *
 * Запуск: npx tsx prisma/seed-office-journals-to-points-2026-11.ts [--dry-run]
 */
import "dotenv/config";

import { db } from "../src/lib/db";
import { moveOfficeJournalsToPoints } from "../src/lib/office-journals.server";

const DRY_RUN = process.argv.includes("--dry-run");
const TAG = DRY_RUN ? "[office-journals:dry-run]" : "[office-journals]";
const ONCE_KEY = "once:office-journals-to-points:v1";

async function main() {
  if (await db.platformSetting.findUnique({ where: { key: ONCE_KEY } })) {
    console.log(`${TAG} ${ONCE_KEY}: already done`);
    return;
  }
  const moves = await moveOfficeJournalsToPoints({ dryRun: DRY_RUN });
  const withTarget = moves.filter((move) => move.targetId);
  const sum = (pick: (move: (typeof moves)[number]) => number) => withTarget.reduce((total, move) => total + pick(move), 0);
  const totals = {
    organizations: moves.length,
    withoutSites: moves.length - withTarget.length,
    documents: { moved: sum((m) => m.documents.moved), overlap: sum((m) => m.documents.overlap), disabled: sum((m) => m.documents.disabled) },
    paper: { moved: sum((m) => m.paperDocuments.moved), overlap: sum((m) => m.paperDocuments.overlap), disabled: sum((m) => m.paperDocuments.disabled) },
  };
  // Итог — одной строкой и последней: на выкладке лог обрезается `tail`.
  console.log(
    `${TAG} organizations with office journals ${totals.organizations} (without sites ${totals.withoutSites}); ` +
      `documents ${DRY_RUN ? "would move" : "moved"} ${totals.documents.moved}, kept as duplicates ${totals.documents.overlap}, kept as disabled ${totals.documents.disabled}; ` +
      `paper ${DRY_RUN ? "would move" : "moved"} ${totals.paper.moved}, kept as duplicates ${totals.paper.overlap}, kept as disabled ${totals.paper.disabled}`,
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

/**
 * Откат версий отпечатка связей обмена справочниками (серия D, Р1).
 *
 * Перед revert серии C2 (#276) или любой правки, меняющей версии составов
 * полей (`ENTITY_FIELD_VERSIONS` в src/lib/directory-exchange/kinds.ts),
 * связи помещений и должностей с отпечатком новой версии (`v2:…`, `f:v2:…`)
 * пересчитываются в составе прежней версии — тогда код до правки видит записи
 * неизменёнными и не переписывает соседей. Правила — в
 * src/lib/directory-exchange/hash-downgrade.ts, порядок отката —
 * docs/directory-exchange-rollback.md.
 *
 * По умолчанию — пробный прогон: только отчёт по кабинетам, ничего не пишется.
 * `--apply` — запись: по кабинету в одной транзакции под замком обмена; занятый
 * кабинет пропускается (код выхода тогда 1 — запустите ещё раз). Повторный
 * `--apply` — 0 изменений. `--apply` пишет только при паузе обмена
 * (`DIRECTORY_EXCHANGE_PAUSED=1` в `.env` приложения + `pm2 restart`): иначе
 * обмен нынешнего кода вернёт связи на новую версию; `--force` — без паузы.
 *
 *   npx tsx scripts/directory-exchange-hash-downgrade.ts                  # что будет сделано
 *   npx tsx scripts/directory-exchange-hash-downgrade.ts --apply          # сделать (при паузе обмена)
 *   npx tsx scripts/directory-exchange-hash-downgrade.ts --cabinet=<id>   # один кабинет
 *   npx tsx scripts/directory-exchange-hash-downgrade.ts --to-version=2   # откат к версии 2 (по умолчанию 1)
 */
import "dotenv/config";

import { db } from "../src/lib/db";
import { DEFAULT_DOWNGRADE_VERSION, downgradeApplyGate, type DowngradeCounts } from "../src/lib/directory-exchange/hash-downgrade";
import { downgradeCabinetHashes, listDowngradeCabinets } from "../src/lib/directory-exchange/hash-downgrade.server";
import { EXCHANGE_PAUSE_ENV, isExchangePaused } from "../src/lib/directory-exchange/pause";

const LEFT_LABELS: Record<keyof DowngradeCounts["left"], string> = {
  edited: "правили после обмена — код до отката разнесёт правку",
  missing_row: "записи нет",
  tombstone: "надгробие",
  unknown_version: "версия новее кода",
  unreadable: "не посчитать",
};

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function describe(counts: DowngradeCounts): string {
  const byEntity = Object.entries(counts.byEntity)
    .map(([entity, count]) => `${entity} ${count}`)
    .join(", ");
  const left = Object.entries(counts.left)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([reason, count]) => `${LEFT_LABELS[reason as keyof DowngradeCounts["left"]]}: ${count}`)
    .join("; ");
  return `${counts.rewrite}${byEntity ? ` (${byEntity})` : ""}${left ? `; оставлено как есть — ${left}` : ""}`;
}

async function main(): Promise<number> {
  const apply = process.argv.includes("--apply");
  const unknown = process.argv
    .slice(2)
    .filter((arg) => arg !== "--apply" && arg !== "--force" && !arg.startsWith("--cabinet=") && !arg.startsWith("--to-version="));
  if (unknown.length > 0) {
    console.error(`неизвестные аргументы: ${unknown.join(" ")}`);
    return 2;
  }
  const gate = downgradeApplyGate({ apply, force: process.argv.includes("--force"), paused: isExchangePaused() });
  if (gate === "refused") {
    console.error(
      `--apply только при паузе обмена: ${EXCHANGE_PAUSE_ENV}=1 в .env приложения, затем pm2 restart (docs/directory-exchange-rollback.md). ` +
        "Иначе обмен нынешнего кода вернёт связи на новую версию. Ничего не записано; без паузы — --force.",
    );
    return 2;
  }
  if (gate === "forced") {
    console.warn(`ВНИМАНИЕ: --force без паузы обмена (${EXCHANGE_PAUSE_ENV}) — обмен до выката отката вернёт связи своего кабинета на новую версию.`);
  }
  const targetVersion = Number(argValue("to-version") ?? DEFAULT_DOWNGRADE_VERSION);
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    console.error("--to-version — целое число от 1");
    return 2;
  }
  const only = argValue("cabinet");
  const cabinets = only ? [only] : await listDowngradeCabinets(targetVersion);
  const names = new Map(
    (await db.organization.findMany({ where: { id: { in: cabinets } }, select: { id: true, name: true } })).map((row) => [row.id, row.name]),
  );

  console.log(`${apply ? "ЗАПИСЬ" : "ПРОБНЫЙ ПРОГОН (ничего не пишется; запись — с --apply)"}: откат отпечатков к версии ${targetVersion}, кабинетов: ${cabinets.length}`);
  let total = 0;
  let failed = 0;
  for (const cabinetId of cabinets) {
    const label = `«${names.get(cabinetId) ?? "?"}» (${cabinetId})`;
    try {
      const result = await downgradeCabinetHashes(cabinetId, { apply, targetVersion });
      if (result.status === "busy") {
        failed += 1;
        console.log(`${label}: ЗАНЯТ обменом — пропущен, ничего не записано; запустите ещё раз`);
        continue;
      }
      if (result.status === "applied") {
        total += result.written;
        console.log(`${label}: записано ${result.written} из ${describe(result.counts)}${result.stale ? `; отпечаток сменился до записи: ${result.stale}` : ""}`);
      } else {
        total += result.counts.rewrite;
        console.log(`${label}: переписать ${describe(result.counts)}`);
      }
    } catch (error) {
      failed += 1;
      console.error(`${label}: ОШИБКА — ${(error as Error)?.message ?? error}`);
    }
  }
  console.log(`${apply ? "Записано связей" : "Связей к записи"}: ${total}${failed ? `; кабинетов пропущено или с ошибкой: ${failed}` : ""}`);
  return failed > 0 ? 1 : 0;
}

main()
  .catch((error) => {
    console.error("сбой", error);
    return 1;
  })
  .then(async (code) => {
    await db.$disconnect().catch(() => undefined);
    process.exit(code);
  });

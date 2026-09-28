/**
 * Стартовый набор промокодов — src/lib/promo/starter-codes.ts.
 *
 * Идемпотентен: код, который уже есть, не трогаем вовсе (ни срок, ни
 * лимит, ни «включён» — ROOT мог их поменять). Новые коды создаются
 * ВЫКЛЮЧЕННЫМИ: включает ROOT на /root/promo-codes, когда канал готов.
 * Без `--apply` — сухой прогон.
 *
 *   npx tsx --env-file=.env scripts/seed-promo-codes.ts          # что будет сделано
 *   npx tsx --env-file=.env scripts/seed-promo-codes.ts --apply  # создать
 */

import { db } from "../src/lib/db";
import { formatMskDateTime } from "../src/lib/promo/promotions";
import { describeDiscount, isValidPromoCodeFormat } from "../src/lib/promo/rules";
import { STARTER_PROMO_CODES } from "../src/lib/promo/starter-codes";

const APPLY = process.argv.includes("--apply");

function period(start: Date | null, end: Date | null): string {
  const from = start ? `с ${formatMskDateTime(start)}` : "сразу";
  const to = end ? `по ${formatMskDateTime(end)} МСК` : "без срока";
  return `${from} ${to}`;
}

async function main() {
  let created = 0;
  let skipped = 0;
  for (const item of STARTER_PROMO_CODES) {
    if (!isValidPromoCodeFormat(item.code)) throw new Error(`Некорректный код ${item.code}`);
    const line =
      `${item.code}: ${describeDiscount(item)}, ${period(item.startsAt, item.endsAt)}, ` +
      `лимит ${item.maxUses ?? "—"}${item.newClientsOnly ? ", только новым" : ""}`;
    const exists = await db.promoCode.findUnique({ where: { code: item.code }, select: { id: true, active: true } });
    if (exists) {
      skipped += 1;
      console.info(`[promo] seed: ${item.code} уже есть (${exists.active ? "включён" : "выключен"}) — не трогаю`);
      continue;
    }
    if (!APPLY) {
      console.info(`[promo] seed (dry-run): создам выключенным — ${line}`);
      continue;
    }
    await db.promoCode.create({
      data: {
        code: item.code,
        kind: item.kind,
        value: item.value,
        active: false,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        maxUses: item.maxUses,
        newClientsOnly: item.newClientsOnly,
        note: item.note,
      },
    });
    created += 1;
    console.info(`[promo] seed: создан выключенным — ${line}`);
  }
  console.info(
    APPLY
      ? `[promo] seed: создано ${created}, уже было ${skipped}. Включить — ROOT → Промокоды.`
      : `[promo] seed: DRY-RUN. Запустите с --apply, чтобы создать.`
  );
}

main()
  .catch((error) => {
    console.error("[promo] seed failed", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

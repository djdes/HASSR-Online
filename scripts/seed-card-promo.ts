/**
 * Промокод акции по визитке — src/lib/promo/card-offer.ts (VIZITKA10).
 *
 * Идемпотентен: кода нет — создаёт ВКЛЮЧЁННЫМ (визитки уже печатаются с QR
 * на /vizitka); код есть — не трогает (ROOT мог поменять размер или
 * выключить акцию на /root/promo-codes). Без `--apply` — сухой прогон.
 *
 *   npx tsx --env-file=.env scripts/seed-card-promo.ts          # что будет сделано
 *   npx tsx --env-file=.env scripts/seed-card-promo.ts --apply  # создать
 */

import { db } from "../src/lib/db";
import { CARD_PROMO_RECORD } from "../src/lib/promo/card-offer";
import { describeDiscount, isValidPromoCodeFormat } from "../src/lib/promo/rules";

const APPLY = process.argv.includes("--apply");

async function main() {
  const item = CARD_PROMO_RECORD;
  if (!isValidPromoCodeFormat(item.code)) throw new Error(`Некорректный код ${item.code}`);
  const line = `${item.code}: ${describeDiscount(item)}, без срока и лимита${item.newClientsOnly ? ", только новым" : ""}`;
  const exists = await db.promoCode.findUnique({ where: { code: item.code }, select: { active: true } });
  if (exists) {
    console.info(`[promo] card: ${item.code} уже есть (${exists.active ? "включён" : "выключен"}) — не трогаю`);
    return;
  }
  if (!APPLY) {
    console.info(`[promo] card (dry-run): создам включённым — ${line}`);
    return;
  }
  await db.promoCode.create({
    data: {
      code: item.code,
      kind: item.kind,
      value: item.value,
      active: true,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      maxUses: item.maxUses,
      newClientsOnly: item.newClientsOnly,
      lifetime: item.lifetime,
      note: item.note,
      campaignId: "vizitka",
    },
  });
  console.info(`[promo] card: создан включённым — ${line}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

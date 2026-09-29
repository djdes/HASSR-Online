import { db } from "@/lib/db";
import { readFreePeriodSettings } from "@/lib/billing.server";
import { readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { invoiceRequisitesReady } from "@/lib/invoices/build";
import { readActivePromotion } from "@/lib/promo/offer";
import { TARIFF_MONTHLY, fallbackTariffs, readTariffs } from "@/lib/tariffs";

import type { ProposalContext } from "./content";
import type { ProposalSender } from "./types";
import { normalizeSender } from "./vars";

/**
 * Данные КП на момент отрисовки: цена тарифа и акция (как на витринах),
 * бесплатный период, реквизиты и отправитель по умолчанию. Всё из базы —
 * смена цены или реквизитов в ROOT сразу видна в новых КП и в уже
 * разосланных веб-версиях.
 */

/** Ключ `PlatformSetting` с отправителем КП по умолчанию (JSON). */
export const PROPOSAL_SENDER_SETTING_KEY = "proposal.sender";

export async function readDefaultProposalSender(): Promise<ProposalSender | null> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: PROPOSAL_SENDER_SETTING_KEY } });
    if (!row) return null;
    return normalizeSender(JSON.parse(row.value));
  } catch (error) {
    console.error("[kp] default sender read failed", error);
    return null;
  }
}

export async function writeDefaultProposalSender(sender: ProposalSender): Promise<ProposalSender> {
  const value = normalizeSender(sender);
  if (!value) throw new Error("Укажите имя отправителя");
  await db.platformSetting.upsert({
    where: { key: PROPOSAL_SENDER_SETTING_KEY },
    create: { key: PROPOSAL_SENDER_SETTING_KEY, value: JSON.stringify(value) },
    update: { value: JSON.stringify(value) },
  });
  return value;
}

export async function loadProposalContext(now: Date = new Date()): Promise<ProposalContext> {
  // Цена — тарифа «Подписка» из `PlatformTariff`. Недоступна база — та же
  // запасная цена, что у лендинга (`fallbackTariffs`), с записью в лог.
  // Снятый с продажи тариф КП не прячет: ROOT-генератор предупреждает
  // об этом (`tariffActive`), рассылка видит строку в логе.
  const tariffs = await readTariffs().catch((error) => {
    console.error("[kp] tariff read failed — fallback price", error);
    return null;
  });
  const fallback = fallbackTariffs().find((item) => item.key === TARIFF_MONTHLY) ?? fallbackTariffs()[0];
  const tariff = tariffs?.find((item) => item.key === TARIFF_MONTHLY) ?? null;
  if (tariff && !tariff.active) console.warn("[kp] monthly tariff is inactive — offer shows its last price");
  const [promotion, freePeriod, requisites, defaultSender] = await Promise.all([
    readActivePromotion(now).catch((error) => {
      console.error("[kp] active promotion read failed", error);
      return null;
    }),
    readFreePeriodSettings(),
    readPlatformRequisites().catch((error) => {
      console.error("[kp] requisites read failed", error);
      return null;
    }),
    readDefaultProposalSender(),
  ]);
  return {
    now,
    tariffPriceRub: (tariff ?? fallback).priceRub,
    tariffActive: tariff ? tariff.active : false,
    promotion,
    freePeriod,
    requisites,
    invoiceReady: requisites ? invoiceRequisitesReady(requisites) : false,
    defaultSender,
  };
}

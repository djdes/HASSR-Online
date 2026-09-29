import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import { countPromoCodeUses, findPromoCodeRecord } from "./checkout";
import {
  createPersonalPromoCodesWith,
  PromoCodeConflictError,
  promoLinkStatusWith,
  readPromoForOfferWith,
  type PersonalCodeOptions,
  type PersonalCodeRequest,
  type PersonalCodeStore,
  type PromoLinkStatus,
} from "./personal-codes-core";

/**
 * Персональные промокоды для рассылки и генератора КП. Сигнатуры
 * заморожены спекой promo-personal (их ждут proposal-kp и mailing):
 *
 *   createPersonalPromoCodes(requests, options) → Map<key, { id, code }>
 *   suggestPersonalCode(companyName, value)      → «ROMASHKA10» / «KP7F3Q10»
 *   promoLinkUrl(code, { sphere?, baseUrl? })    → https://wesetup.ru/promo/<CODE>?s=<sphere>
 *   readPromoForOffer(code)                      → данные для текста или null
 *
 * Каждый созданный код: активный, персональный (почта и/или организация
 * из запроса), `maxUses = 1` (одна оплата по коду; скидка навсегда после
 * неё работает сама), без «только новым», в заметке — companyName.
 * Ошибка входа (нет ни почты, ни организации, повтор key, скидка вне
 * пределов, endsAt в прошлом) — исключение, ничего не создаётся.
 */

export type { PersonalCodeOptions, PersonalCodeRequest, PromoLinkStatus } from "./personal-codes-core";
export { promoLinkUrl, suggestPersonalCode } from "./personal-link";

const dbPersonalCodeStore: PersonalCodeStore = {
  async existingCodes(codes) {
    if (codes.length === 0) return new Set();
    const rows = await db.promoCode.findMany({ where: { code: { in: codes } }, select: { code: true } });
    return new Set(rows.map((row) => row.code));
  },
  async createAll(rows) {
    try {
      // Одна транзакция на всю пачку: либо все коды, либо ни одного.
      return await db.$transaction(
        rows.map((row) => db.promoCode.create({ data: row, select: { id: true, code: true } }))
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new PromoCodeConflictError();
      }
      throw error;
    }
  },
};

/** key → созданный код. Один запрос — один новый активный код, персональный (email и/или organizationId). */
export async function createPersonalPromoCodes(
  requests: PersonalCodeRequest[],
  options: PersonalCodeOptions
): Promise<Map<string, { id: string; code: string }>> {
  return createPersonalPromoCodesWith(dbPersonalCodeStore, requests, options);
}

const lookupDeps = { findCode: findPromoCodeRecord, countCodeUses: countPromoCodeUses };

/** Данные кода для текста предложения; null — нет/не действует. */
export async function readPromoForOffer(code: string): Promise<{
  code: string;
  kind: "percent" | "fixed";
  value: number;
  lifetime: boolean;
  endsAt: Date | null;
} | null> {
  return readPromoForOfferWith(lookupDeps, code);
}

/** Действует ли код сам по себе и почему нет — для ссылки /promo/CODE. */
export async function promoLinkStatus(code: string): Promise<PromoLinkStatus> {
  return promoLinkStatusWith(lookupDeps, code);
}

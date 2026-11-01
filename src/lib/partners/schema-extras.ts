import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import {
  REWARD_RULE_2026_11_COMMENT,
  REWARD_TERMS_2026_11,
  STARTING_REWARD_RULE,
  shouldAdoptRewardRule2026_11,
  type RewardRule,
} from "./rewards";

/**
 * То, что Prisma-схема выразить не умеет, но без чего инварианты партнёрки
 * держатся только на прикладном коде:
 *
 *  • у организации не больше одного активного партнёра — частичный
 *    уникальный индекс по `organizationId WHERE detachedAt IS NULL`;
 *  • правила вознаграждения v1 существуют всегда — иначе первой оплате
 *    не по чему начислять.
 *
 * Идемпотентно, вызывается лениво из первого запроса, которому это нужно
 * (`prisma db push` на деплое создаёт таблицы, но не частичные индексы).
 */
let ensured: Promise<void> | null = null;

export function ensurePartnerSchemaExtras(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await db.$executeRawUnsafe(
        'CREATE UNIQUE INDEX IF NOT EXISTS "PartnerClient_one_active_per_org" ' +
          'ON "PartnerClient" ("organizationId") WHERE "detachedAt" IS NULL',
      );
      await ensureDefaultRewardRule();
      await ensureRewardRule2026_11();
    })().catch((error) => {
      ensured = null;
      throw error;
    });
  }
  return ensured;
}

export async function ensureDefaultRewardRule(): Promise<void> {
  const count = await db.partnerRewardRule.count();
  if (count > 0) return;
  await db.partnerRewardRule
    .create({
      data: {
        version: STARTING_REWARD_RULE.version,
        subscriptionPercent: new Prisma.Decimal(STARTING_REWARD_RULE.subscriptionPercent),
        subscriptionMonths: STARTING_REWARD_RULE.subscriptionMonths,
        hardwarePercent: new Prisma.Decimal(STARTING_REWARD_RULE.hardwarePercent),
        bonusAmountRub: new Prisma.Decimal(STARTING_REWARD_RULE.bonusAmountRub),
        bonusAfterPayments: STARTING_REWARD_RULE.bonusAfterPayments,
        minPayoutRub: new Prisma.Decimal(STARTING_REWARD_RULE.minPayoutRub),
        effectiveFrom: new Date(),
        comment: "Стартовые правила партнёрской программы",
      },
    })
    .catch((error: unknown) => {
      // Параллельный первый запрос мог успеть раньше — версия уникальна.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return;
      }
      throw error;
    });
}

/**
 * Ставка 30 % с подписки в первый год клиента — один раз после выкладки,
 * поверх стартовых условий (см. `shouldAdoptRewardRule2026_11`). Номер —
 * следующий за действующим, как у версий из ROOT; гонку двух первых
 * запросов гасит уникальный `version`.
 */
export async function ensureRewardRule2026_11(): Promise<void> {
  const latest = await db.partnerRewardRule.findFirst({ orderBy: { version: "desc" } });
  if (!shouldAdoptRewardRule2026_11(latest ? toRewardRule(latest) : null, latest?.createdAt ?? null)) return;
  await db.partnerRewardRule
    .create({
      data: {
        version: latest!.version + 1,
        subscriptionPercent: new Prisma.Decimal(REWARD_TERMS_2026_11.subscriptionPercent),
        subscriptionMonths: REWARD_TERMS_2026_11.subscriptionMonths,
        hardwarePercent: new Prisma.Decimal(REWARD_TERMS_2026_11.hardwarePercent),
        bonusAmountRub: new Prisma.Decimal(REWARD_TERMS_2026_11.bonusAmountRub),
        bonusAfterPayments: REWARD_TERMS_2026_11.bonusAfterPayments,
        minPayoutRub: new Prisma.Decimal(REWARD_TERMS_2026_11.minPayoutRub),
        effectiveFrom: new Date(),
        comment: REWARD_RULE_2026_11_COMMENT,
      },
    })
    .catch((error: unknown) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return;
      }
      throw error;
    });
}

export function toRewardRule(row: {
  version: number;
  subscriptionPercent: Prisma.Decimal | number;
  subscriptionMonths: number;
  hardwarePercent: Prisma.Decimal | number;
  bonusAmountRub: Prisma.Decimal | number;
  bonusAfterPayments: number;
  minPayoutRub: Prisma.Decimal | number;
}): RewardRule {
  return {
    version: row.version,
    subscriptionPercent: Number(row.subscriptionPercent),
    subscriptionMonths: row.subscriptionMonths,
    hardwarePercent: Number(row.hardwarePercent),
    bonusAmountRub: Number(row.bonusAmountRub),
    bonusAfterPayments: row.bonusAfterPayments,
    minPayoutRub: Number(row.minPayoutRub),
  };
}

/** Действующая версия правил — последняя по номеру. */
export async function getCurrentRewardRule(): Promise<RewardRule> {
  await ensurePartnerSchemaExtras();
  const row = await db.partnerRewardRule.findFirst({ orderBy: { version: "desc" } });
  return row ? toRewardRule(row) : STARTING_REWARD_RULE;
}

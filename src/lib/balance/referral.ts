import crypto from "node:crypto";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { splitOrderAmount } from "@/lib/partners/accruals";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { escapeTelegramHtml, notifyOrganization } from "@/lib/telegram";

import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_MAX_ORG_AGE_DAYS,
  formatPoints,
  referralRewardFor,
} from "./constants";
import { sendReferralRewardEmail } from "./emails";
import { applyBalanceChange, DuplicateBalanceChangeError } from "./ledger";
import { isTopupOrder } from "./topup-core";

/**
 * Реферальная программа клиент → клиент.
 *
 * Не путать с партнёрской (`src/lib/partners/*`): та договорная, с
 * выплатами деньгами и своим кабинетом. Здесь — «порекомендуй другу,
 * получи 30 % его первой подписки баллами на баланс своей организации».
 *
 * Атрибуция только для НОВЫХ организаций: иначе клик по ссылке
 * «присваивал» бы существующих клиентов. Если у организации есть
 * действующее партнёрское сопровождение, реферальная награда не
 * начисляется — одна атрибуция на организацию, партнёрская программа
 * старше и договорная.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function randomCode(): string {
  const bytes = crypto.randomBytes(REFERRAL_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    out += REFERRAL_CODE_ALPHABET[bytes[i] % REFERRAL_CODE_ALPHABET.length];
  }
  return out;
}

/** Код организации, создавая его при первом обращении. Retry на гонку по @unique. */
export async function ensureReferralCode(organizationId: string): Promise<string> {
  const existing = await db.organization.findUnique({
    where: { id: organizationId },
    select: { referralCode: true },
  });
  if (existing?.referralCode) return existing.referralCode;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode();
    try {
      const updated = await db.organization.update({
        where: { id: organizationId },
        data: { referralCode: code },
        select: { referralCode: true },
      });
      return updated.referralCode ?? code;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Не удалось выдать реферальный код");
}

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== REFERRAL_CODE_LENGTH) return null;
  if (!/^[A-Z0-9]+$/.test(code)) return null;
  return code;
}

export async function resolveReferrerByCode(
  raw: string | null | undefined,
): Promise<{ id: string; name: string } | null> {
  const code = normalizeReferralCode(raw);
  if (!code) return null;
  return db.organization.findUnique({
    where: { referralCode: code },
    select: { id: true, name: true },
  });
}

/**
 * Привязка «кто кого привёл». Best-effort: любая причина отказа —
 * молчаливый `false`, регистрация и оплата от этого не ломаются.
 */
export async function attachReferral(input: {
  organizationId: string;
  referrerOrganizationId: string | null;
  actorUserId?: string | null;
}): Promise<boolean> {
  const referrerId = input.referrerOrganizationId;
  if (!referrerId) return false;
  if (referrerId === input.organizationId) return false;

  try {
    const [organization, referrer] = await Promise.all([
      db.organization.findUnique({
        where: { id: input.organizationId },
        select: {
          id: true,
          accountId: true,
          createdAt: true,
          isDemo: true,
          referredByOrganizationId: true,
        },
      }),
      db.organization.findUnique({
        where: { id: referrerId },
        select: { id: true, accountId: true, isDemo: true },
      }),
    ]);
    if (!organization || !referrer) return false;
    if (organization.referredByOrganizationId) return false;
    if (organization.isDemo || referrer.isDemo) return false;
    // Самореферал: обе организации под одним аккаунтом.
    if (
      organization.accountId &&
      referrer.accountId &&
      organization.accountId === referrer.accountId
    ) {
      return false;
    }
    if (
      Date.now() - organization.createdAt.getTime() >
      REFERRAL_MAX_ORG_AGE_DAYS * DAY_MS
    ) {
      return false;
    }
    const paidBefore = await db.paymentOrder.count({
      where: {
        organizationId: organization.id,
        status: { in: ["paid", "completed"] },
      },
    });
    if (paidBefore > 0) return false;

    const claimed = await db.organization.updateMany({
      where: { id: organization.id, referredByOrganizationId: null },
      data: {
        referredByOrganizationId: referrer.id,
        referredAt: new Date(),
      },
    });
    return claimed.count > 0;
  } catch (error) {
    console.error("attachReferral failed", error);
    return false;
  }
}

/** Есть ли у организации действующее партнёрское сопровождение. */
async function hasActivePartnerLink(organizationId: string): Promise<boolean> {
  const link = await db.partnerClient.findFirst({
    where: {
      organizationId,
      OR: [{ detachedAt: null }, { detachedAt: { gte: new Date() } }],
      partner: { status: "active" },
    },
    select: { id: true },
  });
  return Boolean(link);
}

/**
 * Награда рефереру за первый оплаченный заказ приглашённой организации.
 *
 * База — подписочная часть заказа ПЛЮС списанные баллы: иначе клиент,
 * оплативший подписку баллами, приносил бы рефереру ноль, хотя подписка
 * продана. Идемпотентно по `referral_reward:<приглашённая организация>`:
 * награда одна на организацию, а не на заказ.
 */
export async function accrueReferralReward(orderId: number): Promise<number> {
  const order = await db.paymentOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      organizationId: true,
      tariffKey: true,
      amountRub: true,
      bundleConfig: true,
      pointsSpent: true,
      status: true,
      refundedAt: true,
    },
  });
  if (!order || !order.organizationId) return 0;
  if (order.status !== "paid" && order.status !== "completed") return 0;
  if (order.refundedAt) return 0;
  // Пополнение баланса — не покупка подписки: награда «30 % первой
  // подписки» одна на организацию, и первое пополнение съело бы её (30 %
  // от суммы до 300 000 ₽). Награда придёт с оплатой подписки — база
  // учитывает и баллы, в том числе из пополнения.
  if (isTopupOrder(order)) return 0;

  const organization = await db.organization.findUnique({
    where: { id: order.organizationId },
    select: { id: true, name: true, referredByOrganizationId: true },
  });
  if (!organization?.referredByOrganizationId) return 0;
  if (await hasActivePartnerLink(organization.id)) return 0;

  const base =
    splitOrderAmount({
      amountRub: order.amountRub,
      bundleConfig: order.bundleConfig,
    }).subscriptionRub + order.pointsSpent;
  const reward = referralRewardFor(base);
  if (reward <= 0) return 0;

  const referrerId = organization.referredByOrganizationId;
  try {
    await db.$transaction((tx) =>
      applyBalanceChange(tx, {
        organizationId: referrerId,
        amount: reward,
        kind: "referral_reward",
        description: `Друг оплатил подписку: ${organization.name}`,
        dedupeKey: `referral_reward:${organization.id}`,
        paymentOrderId: order.id,
        referredOrganizationId: organization.id,
      }),
    );
  } catch (error) {
    if (error instanceof DuplicateBalanceChangeError) return 0;
    throw error;
  }

  notifyOrganization(
    referrerId,
    `🎁 На баланс организации начислено <b>${formatPoints(reward)}</b>: приглашённое вами заведение ${escapeTelegramHtml(
      organization.name,
    )} оплатило подписку. Баллы спишутся при следующей оплате — раздел «Баланс и бонусы».`,
  ).catch((err) => console.error("referral notify failed", err));

  const referrer = await db.organization
    .findUnique({
      where: { id: referrerId },
      select: { name: true, balanceRub: true },
    })
    .catch(() => null);

  // Письмо рекомендателю — тому, кто заводил организацию: Telegram
  // привязан не у всех, а узнать о начислении человек должен обязательно.
  const referrerOwner = await db.user
    .findFirst({
      where: {
        organizationId: referrerId,
        isActive: true,
        email: { not: { endsWith: "@invite.local" } },
      },
      orderBy: { createdAt: "asc" },
      select: { email: true },
    })
    .catch(() => null);
  if (referrerOwner?.email) {
    sendReferralRewardEmail({
      to: referrerOwner.email,
      friendOrganizationName: organization.name,
      rewardRub: reward,
      balanceRub: referrer?.balanceRub ?? reward,
    }).catch((err) => console.error("sendReferralRewardEmail failed", err));
  }

  notifyPlatformAdmin(
    [
      "🤝 Реферальная награда",
      `Пригласил: ${escapeTelegramHtml(referrer?.name ?? referrerId)}`,
      `Оплатил: ${escapeTelegramHtml(organization.name)}`,
      `Начислено: ${formatPoints(reward)} (база ${formatPoints(base)})`,
      `Заказ №${order.id}`,
    ].join("\n"),
    { kind: "referral" },
  ).catch((err) => console.error("referral admin notify failed", err));

  return reward;
}

export type ReferralInviteView = {
  id: string;
  email: string;
  createdAt: string;
  /** sent — письмо ушло, registered — завёл организацию, paid — оплатил. */
  status: "sent" | "registered" | "paid";
  rewardRub: number;
};

/**
 * Приглашения со статусами. Статус не хранится — выводим при чтении,
 * чтобы не держать вторую копию правды рядом с организациями и леджером.
 */
export async function listReferralInvites(
  organizationId: string,
): Promise<ReferralInviteView[]> {
  const invites = await db.referralInvite.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  if (invites.length === 0) return [];

  const users = await db.user.findMany({
    where: { email: { in: invites.map((i) => i.email) } },
    select: { email: true, organizationId: true },
  });
  const invitedOrgIds = Array.from(new Set(users.map((u) => u.organizationId)));
  const referredOrgs = invitedOrgIds.length
    ? await db.organization.findMany({
        where: {
          id: { in: invitedOrgIds },
          referredByOrganizationId: organizationId,
        },
        select: { id: true },
      })
    : [];
  const referredIds = new Set(referredOrgs.map((o) => o.id));
  const orgByEmail = new Map(users.map((u) => [u.email, u.organizationId]));

  const rewards = referredIds.size
    ? await db.balanceTransaction.findMany({
        where: {
          organizationId,
          kind: "referral_reward",
          referredOrganizationId: { in: Array.from(referredIds) },
        },
        select: { referredOrganizationId: true, amount: true },
      })
    : [];
  const rewardByOrg = new Map(
    rewards.map((r) => [r.referredOrganizationId ?? "", r.amount]),
  );

  return invites.map((invite) => {
    const orgId = orgByEmail.get(invite.email) ?? null;
    const registered = orgId !== null && referredIds.has(orgId);
    const reward = registered ? (rewardByOrg.get(orgId) ?? 0) : 0;
    return {
      id: invite.id,
      email: invite.email,
      createdAt: invite.createdAt.toISOString(),
      status: reward > 0 ? "paid" : registered ? "registered" : "sent",
      rewardRub: reward,
    };
  });
}

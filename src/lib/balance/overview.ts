import { db } from "@/lib/db";
import { readLegalProfile } from "@/lib/org-legal-profile";
import { cityFromAddress } from "@/lib/orders/org-snapshot";
import { hasCapability } from "@/lib/permission-presets";

import { getBalance, listTransactions, type BalanceTransactionView } from "./ledger";
import {
  ensureReferralCode,
  listReferralInvites,
  type ReferralInviteView,
} from "./referral";
import { reviewPrefill } from "./review-rules";
import { getMyReview, type ReviewView } from "./reviews";

/**
 * Состояние раздела «Баланс и бонусы» — один сборщик на три витрины:
 * страницу сайта, экран Mini App и `GET /api/balance` (обновление после
 * отправки формы). Иначе три места считали бы одно и то же по-разному.
 *
 * Баланс, история и чужие приглашения — только `admin.full`: это деньги
 * организации. Форма отзыва и «как заработать» — всем сотрудникам.
 */
export type BalanceOverview = {
  organizationName: string;
  userName: string;
  canSeeBalance: boolean;
  balanceRub: number;
  /** Личный вклад сотрудника: его отзыв и его приглашения. */
  myEarnedRub: number;
  referralCode: string;
  /**
   * Предзаполнение формы отзыва без дублей: имя человека и «заведение,
   * город». Организация названа как человек — заведение пустое.
   */
  reviewPrefill: { authorName: string; place: string };
  transactions: BalanceTransactionView[];
  invites: ReferralInviteView[];
  myReview: ReviewView | null;
};

type Actor = {
  id: string;
  name?: string | null;
  email?: string | null;
  permissionPreset?: string | null;
  role?: string | null;
  isRoot?: boolean | null;
  orgPresetOverrides?: Record<string, string[]> | null;
};

export async function loadBalanceOverview(
  organizationId: string,
  user: Actor,
): Promise<BalanceOverview> {
  const canSeeBalance = hasCapability(user, "admin.full");

  const [organization, referralCode, myReview] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, address: true, legalProfileJson: true },
    }),
    ensureReferralCode(organizationId),
    getMyReview(user.id),
  ]);

  const [balanceRub, transactions, allInvites] = await Promise.all([
    canSeeBalance ? getBalance(organizationId) : Promise.resolve(0),
    canSeeBalance
      ? listTransactions(organizationId, { take: 100 })
      : Promise.resolve([]),
    listReferralInvites(organizationId),
  ]);

  let invites = allInvites;
  if (!canSeeBalance) {
    const mine = await db.referralInvite.findMany({
      where: { organizationId, invitedByUserId: user.id },
      select: { id: true },
    });
    const mineIds = new Set(mine.map((row) => row.id));
    invites = allInvites.filter((invite) => mineIds.has(invite.id));
  }

  return {
    organizationName: organization?.name ?? "",
    userName: user.name ?? user.email ?? "",
    canSeeBalance,
    balanceRub,
    myEarnedRub:
      (myReview?.status === "approved" ? myReview.rewardRub : 0) +
      invites.reduce((sum, invite) => sum + invite.rewardRub, 0),
    referralCode,
    reviewPrefill: reviewPrefill({
      userName: user.name,
      organizationName: organization?.name ?? null,
      city: cityFromAddress(
        readLegalProfile(organization?.legalProfileJson)?.address ?? organization?.address ?? null,
      ),
    }),
    transactions,
    invites,
    myReview,
  };
}

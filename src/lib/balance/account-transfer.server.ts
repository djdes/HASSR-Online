import { db } from "@/lib/db";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";

import {
  ACCOUNT_TRANSFER_MAX_RUB,
  accountBalanceTotal,
  type AccountBalances,
  isTransferIdempotencyKey,
  normalizeTransferComment,
  transferDedupeKeys,
  transferDescriptions,
} from "./account-transfer";
import { formatPoints } from "./constants";
import { applyBalanceChange, DuplicateBalanceChangeError, InsufficientBalanceError } from "./ledger";

/**
 * Баланс по аккаунту и перевод между своими организациями (серия B, Р10).
 *
 * Только владелец аккаунта (`Account.ownerUserId`) и только организации
 * его аккаунта, кроме демо и мастер-кабинетов: у них нет своих денег.
 * Закрытая после своих 14 дней организация и отдаёт, и получает — деньги
 * её, а точку тарифа можно оплатить и с другого баланса.
 */

export type AccountTransferErrorCode = "not_owner" | "not_found" | "invalid" | "insufficient";

/** Отказ с HTTP-статусом: маршруты отдают его как `{ error, code }`. */
export class AccountTransferError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: AccountTransferErrorCode,
    message: string,
    /** Для перевода фразы на клиенте: `insufficient` — `{ name, balanceRub }`. */
    readonly params: Record<string, string | number> | null = null,
  ) {
    super(message);
    this.name = "AccountTransferError";
  }
}

export type { AccountBalanceOrganization, AccountBalances } from "./account-transfer";

export const ACCOUNT_OWNER_ONLY_MESSAGE = "Баланс по аккаунту и переводы доступны владельцу аккаунта";

const platformOrgId = () => (process.env.PLATFORM_ORG_ID ?? "platform").trim();

/** Организации аккаунта, у которых есть свои деньги. */
function moneyOrgWhere(accountId: string) {
  return { accountId, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE, id: { not: platformOrgId() } };
}

/**
 * Аккаунт, которым владеет человек, — и активная организация должна быть в
 * нём: руководитель чужой компании, который сам владеет другим аккаунтом,
 * из чужой организации переводов не делает.
 */
async function ownedAccountId(ownerUserId: string, activeOrgId: string | null): Promise<string> {
  const account = await db.account.findUnique({ where: { ownerUserId }, select: { id: true } });
  if (!account) throw new AccountTransferError(403, "not_owner", ACCOUNT_OWNER_ONLY_MESSAGE);
  if (activeOrgId) {
    const active = await db.organization.findUnique({ where: { id: activeOrgId }, select: { accountId: true } });
    if (!active || active.accountId !== account.id) {
      throw new AccountTransferError(403, "not_owner", ACCOUNT_OWNER_ONLY_MESSAGE);
    }
  }
  return account.id;
}

/** Организации аккаунта владельца с балансами и итог. Не владелец — 403. */
export async function loadAccountBalances(ownerUserId: string, activeOrgId: string): Promise<AccountBalances> {
  const accountId = await ownedAccountId(ownerUserId, activeOrgId);
  const rows = await db.organization.findMany({
    where: moneyOrgWhere(accountId),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, balanceRub: true },
  });
  const organizations = rows.map((row) => ({ ...row, active: row.id === activeOrgId }));
  return { accountId, activeOrganizationId: activeOrgId, organizations, totalRub: accountBalanceTotal(organizations) };
}

/**
 * Для страницы «Настройки → Баланс»: сводка только владельцу аккаунта, у
 * которого две организации и больше; иначе null (блока нет).
 */
export async function accountBalancesForPage(ownerUserId: string, activeOrgId: string): Promise<AccountBalances | null> {
  try {
    const balances = await loadAccountBalances(ownerUserId, activeOrgId);
    return balances.organizations.length >= 2 ? balances : null;
  } catch (error) {
    if (!(error instanceof AccountTransferError)) console.error("[balance] account balances failed", error);
    return null;
  }
}

export type AccountTransferResult = {
  /** Перевод с этим ключом уже был — вернули его, второй раз не списывали. */
  duplicate: boolean;
  transfer: {
    fromId: string;
    toId: string;
    amountRub: number;
    createdAt: string;
  };
};

/** Перевод, уже проведённый с этими ключами (повтор формы, гонка двух запросов). */
async function earlierTransfer(keys: { out: string; in: string }): Promise<AccountTransferResult | null> {
  const rows = await db.balanceTransaction.findMany({
    where: { dedupeKey: { in: [keys.out, keys.in] } },
    select: { organizationId: true, amount: true, dedupeKey: true, createdAt: true },
  });
  const out = rows.find((row) => row.dedupeKey === keys.out);
  const incoming = rows.find((row) => row.dedupeKey === keys.in);
  if (!out || !incoming) return null;
  return {
    duplicate: true,
    transfer: {
      fromId: out.organizationId,
      toId: incoming.organizationId,
      amountRub: incoming.amount,
      createdAt: incoming.createdAt.toISOString(),
    },
  };
}

/**
 * Перевести деньги между своими организациями: списание `transfer_out` и
 * зачисление `transfer_in` через леджер одной транзакцией, запись в журнал
 * действий обеих организаций — в той же транзакции.
 *
 * Отказы: не владелец — 403; организация не из аккаунта (или демо, кабинет)
 * — 404, как будто её нет; больше остатка — 409. Повтор с тем же ключом —
 * прежний результат с `duplicate: true`, деньги не двигаются.
 */
export async function transferBetweenOwnOrganizations(input: {
  ownerUserId: string;
  actorName?: string | null;
  /** Активная организация сессии: должна быть в аккаунте владельца. */
  activeOrgId?: string | null;
  fromId: string;
  toId: string;
  amountRub: number;
  comment?: string | null;
  idempotencyKey: string;
  ipAddress?: string | null;
}): Promise<AccountTransferResult> {
  const amountRub = input.amountRub;
  if (!Number.isInteger(amountRub) || amountRub < 1 || amountRub > ACCOUNT_TRANSFER_MAX_RUB) {
    throw new AccountTransferError(400, "invalid", "Сумма перевода — целыми рублями, от 1 ₽");
  }
  if (input.fromId === input.toId) {
    throw new AccountTransferError(400, "invalid", "Выберите две разные организации");
  }
  if (!isTransferIdempotencyKey(input.idempotencyKey)) {
    throw new AccountTransferError(400, "invalid", "Обновите страницу и повторите перевод");
  }
  const comment = normalizeTransferComment(input.comment);

  const accountId = await ownedAccountId(input.ownerUserId, input.activeOrgId ?? null);
  const orgs = await db.organization.findMany({
    where: { ...moneyOrgWhere(accountId), id: { in: [input.fromId, input.toId], not: platformOrgId() } },
    select: { id: true, name: true, balanceRub: true },
  });
  const from = orgs.find((org) => org.id === input.fromId);
  const to = orgs.find((org) => org.id === input.toId);
  if (!from || !to) throw new AccountTransferError(404, "not_found", "Организация не найдена");

  const keys = transferDedupeKeys(accountId, input.idempotencyKey);
  const already = await earlierTransfer(keys);
  if (already) return already;

  const descriptions = transferDescriptions({ fromName: from.name, toName: to.name, comment });
  const details = {
    accountId,
    fromOrganizationId: from.id,
    fromName: from.name,
    toOrganizationId: to.id,
    toName: to.name,
    amountRub,
    comment: comment || null,
    idempotencyKey: input.idempotencyKey,
  };
  const actor = { userId: input.ownerUserId, userName: input.actorName ?? null, ipAddress: input.ipAddress ?? null };

  let createdAt: Date;
  try {
    createdAt = await db.$transaction(async (tx) => {
      await applyBalanceChange(tx, {
        organizationId: from.id,
        amount: -amountRub,
        kind: "transfer_out",
        description: descriptions.out,
        dedupeKey: keys.out,
        actorUserId: input.ownerUserId,
      });
      await applyBalanceChange(tx, {
        organizationId: to.id,
        amount: amountRub,
        kind: "transfer_in",
        description: descriptions.in,
        dedupeKey: keys.in,
        actorUserId: input.ownerUserId,
      });
      await tx.auditLog.createMany({
        data: [
          { organizationId: from.id, direction: "out" },
          { organizationId: to.id, direction: "in" },
        ].map((row) => ({
          organizationId: row.organizationId,
          userId: actor.userId,
          userName: actor.userName,
          action: "balance.transfer",
          entity: "account",
          entityId: accountId,
          details: { ...details, direction: row.direction },
          ipAddress: actor.ipAddress,
        })),
      });
      return new Date();
    });
  } catch (error) {
    if (error instanceof DuplicateBalanceChangeError) {
      // Параллельный запрос с тем же ключом успел первым — его итог и отдаём.
      const earlier = await earlierTransfer(keys);
      if (earlier) return earlier;
      throw new AccountTransferError(409, "invalid", "Перевод уже проводится — обновите страницу");
    }
    if (error instanceof InsufficientBalanceError) {
      // Тот же перевод мог пройти параллельно и забрать остаток.
      const earlier = await earlierTransfer(keys);
      if (earlier) return earlier;
      const current = await db.organization.findUnique({ where: { id: from.id }, select: { balanceRub: true } });
      throw new AccountTransferError(
        409,
        "insufficient",
        `Недостаточно средств: на балансе «${from.name}» ${formatPoints(current?.balanceRub ?? 0)}`,
        { name: from.name, balanceRub: current?.balanceRub ?? 0 },
      );
    }
    throw error;
  }

  return {
    duplicate: false,
    transfer: { fromId: from.id, toId: to.id, amountRub, createdAt: createdAt.toISOString() },
  };
}

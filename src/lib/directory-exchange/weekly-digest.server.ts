import type { Prisma } from "@prisma/client";

import { listActiveNetworkManagerIds } from "@/lib/account-roles.server";
import { db } from "@/lib/db";
import {
  EXCHANGE_DIGEST_ACTION,
  EXCHANGE_DIGEST_DAYS,
  EXCHANGE_DIGEST_HREF,
  EXCHANGE_DIGEST_KIND,
  buildExchangeDigest,
  exchangeDigestEmail,
  exchangeDigestHasNews,
  exchangeDigestTelegram,
  exchangeDigestWeekKey,
  exchangeDigestWeekStart,
} from "@/lib/directory-exchange/weekly-digest";
import { MASTER_ORG_KIND } from "@/lib/master-directory";
import { DEFERRED_STATUS, PUSH_ONLY_STATUS } from "@/lib/telegram-delivery-policy";
import { isTechnicalEmail } from "@/lib/technical-email";

/**
 * Еженедельная сводка обмена справочниками (серия E, Р7): владельцу аккаунта
 * и управляющим сетью — письмо и Telegram, если за 7 дней в своих
 * организациях обмена что-то пришло, ждёт разбора или обмен падал. Зовёт
 * ежечасная задача `weekly-digest` в понедельник 08:00 по Москве. Одна сводка
 * на аккаунт за ISO-неделю: отметка в журнале действий кабинета ставится до
 * отправки под замком (аккаунт, неделя) — из двух одновременных запусков
 * шлёт один, повтор за неделю ничего не шлёт; не дошло ничего — отметка
 * снимается, и следующий запуск пробует снова. Закрытые после своих 14 дней
 * организации не считаются. Сбой одного аккаунта остальных не останавливает.
 */

const APP_URL = () => (process.env.NEXTAUTH_URL || process.env.APP_URL || "https://wesetup.ru").replace(/\/+$/, "");

export type ExchangeDigestAccountResult = {
  accountId: string;
  /** `not-delivered` — ничего не дошло: отметка снята, следующий запуск попробует снова. */
  reason: "sent" | "already-sent" | "empty" | "no-members" | "no-recipients" | "not-delivered" | "error";
  recipients?: number;
  emails?: number;
  telegram?: number;
};

export type ExchangeDigestReport = {
  weekKey: string;
  accounts: number;
  sent: number;
  results: ExchangeDigestAccountResult[];
};

type Recipient = { userId: string; email: string | null; telegram: boolean };

async function recipientsOf(accountId: string, ownerUserId: string): Promise<Recipient[]> {
  const managerIds = await listActiveNetworkManagerIds(accountId).catch((error) => {
    console.error("[exchange-digest] managers load failed", { accountId, error });
    return [] as string[];
  });
  const ids = [...new Set([ownerUserId, ...managerIds])];
  const users = await db.user.findMany({
    where: { id: { in: ids }, isActive: true, archivedAt: null },
    select: { id: true, email: true, contactEmail: true, telegramChatId: true },
  });
  return users.map((user) => ({
    userId: user.id,
    email:
      [user.contactEmail, user.email].map((value) => (value ?? "").trim()).find((value) => value.includes("@") && !isTechnicalEmail(value)) ??
      null,
    telegram: Boolean(user.telegramChatId),
  }));
}

/** Статусы журнала Telegram, при которых сообщение дошло или дойдёт (тихие часы — утром, без Telegram — push). */
const TELEGRAM_DELIVERED = ["sent", DEFERRED_STATUS, PUSH_ONLY_STATUS];

/**
 * Занять сводку аккаунта за неделю: под замком (аккаунт, ISO-неделя) в одной
 * транзакции — проверить отметку и записать её. Возвращает id отметки или
 * null, если неделю уже занял другой запуск. Шлёт только тот, кто записал.
 */
async function claimDigest(input: {
  accountId: string;
  weekKey: string;
  weekStart: Date;
  organizationId: string;
  details: Prisma.InputJsonValue;
}): Promise<string | null> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`exchange-digest:${input.accountId}:${input.weekKey}`})::bigint)`;
    const already = await tx.auditLog.findFirst({
      where: { action: EXCHANGE_DIGEST_ACTION, entity: "account", entityId: input.accountId, createdAt: { gte: input.weekStart } },
      select: { id: true },
    });
    if (already) return null;
    const claim = await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: null,
        userName: null,
        action: EXCHANGE_DIGEST_ACTION,
        entity: "account",
        entityId: input.accountId,
        details: input.details,
      },
      select: { id: true },
    });
    return claim.id;
  });
}

async function digestForAccount(input: {
  accountId: string;
  ownerUserId: string;
  cabinetIds: string[];
  now: Date;
  weekKey: string;
  locked: ReadonlySet<string>;
}): Promise<ExchangeDigestAccountResult> {
  const { accountId, cabinetIds, now } = input;
  const already = await db.auditLog.findFirst({
    where: { action: EXCHANGE_DIGEST_ACTION, entity: "account", entityId: accountId, createdAt: { gte: exchangeDigestWeekStart(now) } },
    select: { id: true },
  });
  if (already) return { accountId, reason: "already-sent" };

  const members = await db.directoryExchangeMember.findMany({
    where: { masterOrganizationId: { in: cabinetIds } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { organizationId: true, kinds: true, organization: { select: { name: true, accountId: true, isDemo: true, kind: true } } },
  });
  // Только свои рабочие организации: у организаций другой компании — ничего.
  const own = members.filter(
    (member) => member.organization.accountId === accountId && !member.organization.isDemo && member.organization.kind !== MASTER_ORG_KIND,
  );
  if (own.length === 0) return { accountId, reason: "no-members" };
  const ownIds = [...new Set(own.map((member) => member.organizationId))];
  const since = new Date(now.getTime() - EXCHANGE_DIGEST_DAYS * 86_400_000);

  const [changes, skips, errorRuns] = await Promise.all([
    db.directoryExchangeChange.groupBy({
      by: ["organizationId", "op"],
      where: { masterOrganizationId: { in: cabinetIds }, organizationId: { in: ownIds }, createdAt: { gte: since, lte: now }, undoneAt: null },
      _count: { _all: true },
    }),
    db.directoryExchangeSkip.groupBy({
      by: ["organizationId", "entity"],
      where: { masterOrganizationId: { in: cabinetIds }, organizationId: { in: ownIds } },
      _count: { _all: true },
    }),
    db.directoryExchangeRun.count({
      where: { masterOrganizationId: { in: cabinetIds }, status: "error", startedAt: { gte: since, lte: now } },
    }),
  ]);
  const digest = buildExchangeDigest({
    weekKey: input.weekKey,
    members: own.map((member) => ({ organizationId: member.organizationId, name: member.organization.name, kinds: member.kinds })),
    locked: input.locked,
    changes: changes.map((row) => ({ organizationId: row.organizationId, op: row.op, undone: false, count: row._count._all })),
    skips: skips.map((row) => ({ organizationId: row.organizationId, entity: row.entity, count: row._count._all })),
    errorRuns,
  });
  if (!exchangeDigestHasNews(digest)) return { accountId, reason: "empty" };

  // Дойти можно только до тех, у кого есть почта или Telegram.
  const recipients = (await recipientsOf(accountId, input.ownerUserId)).filter((recipient) => recipient.email || recipient.telegram);
  if (recipients.length === 0) return { accountId, reason: "no-recipients" };

  // Письмо и сообщение готовим до отметки: сбой здесь не оставит отметку без отправки.
  const appUrl = APP_URL();
  const email = exchangeDigestEmail(digest, appUrl);
  const telegramText = exchangeDigestTelegram(digest);
  const { emailBrandForOrganization, isEmailDeliveryConfigured, renderEmailLayout, sendRawEmail } = await import("@/lib/email");
  const { notifyEmployee } = await import("@/lib/telegram");
  const html = renderEmailLayout(email.title, email.html, await emailBrandForOrganization(own[0].organizationId).catch(() => null));
  const dedupeKey = `${EXCHANGE_DIGEST_KIND}:${accountId}:${digest.weekKey}`;

  // Отметка до отправки и атомарно: шлёт только запуск, который её записал.
  const claimId = await claimDigest({
    accountId,
    weekKey: digest.weekKey,
    weekStart: exchangeDigestWeekStart(now),
    organizationId: cabinetIds[0],
    details: {
      week: digest.weekKey,
      recipients: recipients.map((recipient) => recipient.userId),
      rows: digest.rows.length,
      errorRuns: digest.errorRuns,
    },
  });
  if (!claimId) return { accountId, reason: "already-sent" };

  let emails = 0;
  try {
    // Без настроенной почты письмо пишется в журнал сервера — это не сбой (dev).
    const emailDelivers = isEmailDeliveryConfigured();
    for (const recipient of recipients) {
      if (recipient.telegram) {
        try {
          await notifyEmployee(
            recipient.userId,
            telegramText,
            { label: "Открыть обмен", miniAppUrl: `${appUrl}${EXCHANGE_DIGEST_HREF}` },
            { delivery: { organizationId: own[0].organizationId, kind: EXCHANGE_DIGEST_KIND, dedupeKey } },
          );
        } catch (error) {
          console.error("[exchange-digest] telegram failed", { accountId, userId: recipient.userId, error });
        }
      }
      if (recipient.email) {
        try {
          if ((await sendRawEmail(recipient.email, email.subject, html)) || !emailDelivers) emails += 1;
        } catch (error) {
          console.error("[exchange-digest] email failed", { accountId, userId: recipient.userId, error });
        }
      }
    }
  } catch (error) {
    console.error("[exchange-digest] send failed", { accountId, error });
  }
  // Telegram не сообщает об исходе — смотрим журнал отправок: ушло, отложено на утро или ушло push'ем.
  // Ключ — аккаунт и неделя; доставленных строк прошлых попыток этой недели нет: иначе отметка осталась бы.
  const telegram = await db.telegramLog
    .count({
      where: {
        kind: EXCHANGE_DIGEST_KIND,
        dedupeKey,
        userId: { in: recipients.map((recipient) => recipient.userId) },
        status: { in: TELEGRAM_DELIVERED },
      },
    })
    .catch(() => 0);
  if (emails + telegram === 0) {
    // Ничего не дошло — снимаем отметку, следующий запуск попробует снова.
    await db.auditLog.delete({ where: { id: claimId } }).catch((error) => {
      console.error("[exchange-digest] claim release failed", { accountId, error });
    });
    console.warn("[exchange-digest] nothing delivered — will retry", { accountId, week: digest.weekKey });
    return { accountId, reason: "not-delivered", recipients: recipients.length, emails, telegram };
  }
  console.info("[exchange-digest] sent", { accountId, week: digest.weekKey, recipients: recipients.length, emails, telegram });
  return { accountId, reason: "sent", recipients: recipients.length, emails, telegram };
}

/**
 * Сводки всем аккаунтам, у кабинета обмена которых есть участники.
 * `accountId` — только этот аккаунт (проверка). `locked` — закрытые
 * организации (`lockedOrganizationIds`), их не считаем.
 */
export async function sendExchangeWeeklyDigests(options: {
  now?: Date;
  locked?: ReadonlySet<string>;
  accountId?: string;
} = {}): Promise<ExchangeDigestReport> {
  const now = options.now ?? new Date();
  const weekKey = exchangeDigestWeekKey(now);
  const masters = await db.directoryExchangeMember.findMany({
    where: options.accountId ? { masterOrganization: { accountId: options.accountId } } : {},
    distinct: ["masterOrganizationId"],
    select: { masterOrganizationId: true },
  });
  const cabinets = masters.length
    ? await db.organization.findMany({
        where: {
          id: { in: masters.map((row) => row.masterOrganizationId) },
          kind: MASTER_ORG_KIND,
          isDemo: false,
          accountId: { not: null },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, accountId: true, account: { select: { ownerUserId: true } } },
      })
    : [];
  const byAccount = new Map<string, { ownerUserId: string; cabinetIds: string[] }>();
  for (const cabinet of cabinets) {
    if (!cabinet.accountId || !cabinet.account) continue;
    const entry = byAccount.get(cabinet.accountId) ?? { ownerUserId: cabinet.account.ownerUserId, cabinetIds: [] };
    entry.cabinetIds.push(cabinet.id);
    byAccount.set(cabinet.accountId, entry);
  }

  const results: ExchangeDigestAccountResult[] = [];
  for (const [accountId, entry] of byAccount) {
    try {
      results.push(
        await digestForAccount({ accountId, ownerUserId: entry.ownerUserId, cabinetIds: entry.cabinetIds, now, weekKey, locked: options.locked ?? new Set() }),
      );
    } catch (error) {
      console.error("[exchange-digest] account failed", { accountId, error });
      results.push({ accountId, reason: "error" });
    }
  }
  return { weekKey, accounts: byAccount.size, sent: results.filter((result) => result.reason === "sent").length, results };
}

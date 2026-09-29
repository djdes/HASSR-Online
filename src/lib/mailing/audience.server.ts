import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { listBillingUnits, readFreePeriodSettings, stateForUnit } from "@/lib/billing.server";
import type { AccountBillingKind } from "@/lib/billing-period";
import { normalizeSphere } from "@/lib/org-profile";
import { isManagementRole } from "@/lib/user-roles";

import { userMarketingEmail, type AudienceUserRow } from "./audience";
import { pushAvailability, pushSkipReason, telegramBotConfigured } from "./channels.server";
import { overallRecipientStatus, type ChannelStatus, type MailingChannels } from "./labels";
import { newRecipientId, signRecipientToken } from "./tokens";

/**
 * Аудитория рассылки на сервере: строки пользователей для фильтров,
 * выбор (id пользователей и контактов) → план получателей с честными
 * статусами по каналам: кому не дойдёт и почему видно ещё до отправки.
 */

const PLATFORM_ORG_ID = () => (process.env.PLATFORM_ORG_ID ?? "platform").trim();

export const MAX_SELECTION = 20_000;

export type AudienceSelection = { userIds: string[]; contactIds: string[] };

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const v of value) {
    if (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v)) out.add(v);
    if (out.size >= MAX_SELECTION) break;
  }
  return [...out];
}

export function normalizeSelection(raw: unknown): AudienceSelection {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { userIds: ids(r.userIds), contactIds: ids(r.contactIds) };
}

const audienceUserWhere = (): Prisma.UserWhereInput => ({
  isActive: true,
  archivedAt: null,
  isRoot: false,
  organization: { isDemo: false, id: { not: PLATFORM_ORG_ID() } },
});

/** Тариф по организациям: аккаунт → состояние перехода на оплату. */
async function billingKindByOrg(now: Date): Promise<Map<string, AccountBillingKind>> {
  const [settings, units] = await Promise.all([readFreePeriodSettings(), listBillingUnits()]);
  const map = new Map<string, AccountBillingKind>();
  for (const unit of units) {
    const kind = stateForUnit(unit, settings, now).kind;
    for (const orgId of unit.orgIds) map.set(orgId, kind);
  }
  return map;
}

/**
 * Все активные пользователи клиентов (без ROOT, демо и платформы) — одним
 * проходом; фильтры (`audience.ts`) работают над этими строками.
 */
export async function loadAudienceUsers(now: Date = new Date()): Promise<AudienceUserRow[]> {
  const [users, billing] = await Promise.all([
    db.user.findMany({
      where: audienceUserWhere(),
      select: {
        id: true,
        name: true,
        email: true,
        contactEmail: true,
        role: true,
        canManageSettings: true,
        organizationId: true,
        telegramChatId: true,
        marketingOptOut: true,
        createdAt: true,
        organization: { select: { name: true, type: true } },
        _count: {
          select: { webPushSubscriptions: true, mobileDevices: { where: { pushEnabled: true } } },
        },
      },
    }),
    billingKindByOrg(now),
  ]);
  const emails = users.map((u) => userMarketingEmail(u)).filter((e): e is string => Boolean(e));
  const suppressed = new Set(
    emails.length
      ? (await db.emailSuppression.findMany({ where: { email: { in: emails } }, select: { email: true } })).map(
          (r) => r.email
        )
      : []
  );
  return users.map((u) => {
    const email = userMarketingEmail(u);
    return {
      id: u.id,
      name: u.name,
      email,
      isManagement: isManagementRole(u.role) || u.canManageSettings,
      organizationId: u.organizationId,
      organizationName: u.organization.name,
      sphere: normalizeSphere(u.organization.type),
      billing: billing.get(u.organizationId) ?? "exempt",
      hasTelegram: Boolean(u.telegramChatId),
      webPushCount: u._count.webPushSubscriptions,
      appDeviceCount: u._count.mobileDevices,
      createdAt: u.createdAt.toISOString(),
      marketingOptOut: u.marketingOptOut,
      suppressed: email ? suppressed.has(email) : false,
    };
  });
}

export type RecipientDraft = {
  id: string;
  token: string;
  userId: string | null;
  contactId: string | null;
  email: string | null;
  name: string | null;
  companyName: string | null;
  sphere: string | null;
  organizationId: string | null;
  status: string;
  emailStatus: ChannelStatus | null;
  emailError: string | null;
  inAppStatus: ChannelStatus | null;
  inAppError: string | null;
  pushStatus: ChannelStatus | null;
  pushError: string | null;
  telegramStatus: ChannelStatus | null;
  telegramError: string | null;
};

export type PlanStats = {
  selectedUsers: number;
  selectedContacts: number;
  /** Найдено и подходит: пользователи активны, контакты есть в базе. */
  users: number;
  contacts: number;
  /** Не нашлись (удалены, отключены). */
  missing: number;
  /** Контакт с той же почтой, что у выбранного пользователя. */
  duplicates: number;
  /** Контакт выбран, но из каналов только те, что для пользователей. */
  notApplicable: number;
  /** Строк получателей будет создано. */
  recipients: number;
  channels: {
    email: { queued: number; noEmail: number; suppressed: number; optedOut: number; inactiveContact: number };
    /** `optedOut` — отписались от рекламы: им не уходит ни в один канал. */
    inApp: { queued: number; optedOut: number };
    push: {
      queued: number;
      skipped: number;
      optedOut: number;
      webSubs: number;
      appDevices: number;
      webConfigured: boolean;
      appConfigured: boolean;
    };
    telegram: { queued: number; skipped: number; optedOut: number; botConfigured: boolean };
  };
};

export type RecipientPlan = { drafts: RecipientDraft[]; stats: PlanStats };

function emptyDraft(): Omit<RecipientDraft, "id" | "token"> {
  return {
    userId: null,
    contactId: null,
    email: null,
    name: null,
    companyName: null,
    sphere: null,
    organizationId: null,
    status: "queued",
    emailStatus: null,
    emailError: null,
    inAppStatus: null,
    inAppError: null,
    pushStatus: null,
    pushError: null,
    telegramStatus: null,
    telegramError: null,
  };
}

/**
 * Выбор + каналы → получатели. Стоп-лист, отписка, «нет почты», «нет
 * Telegram», «push не настроен» отмечаются сразу как «пропущено» с
 * причиной; стоп-лист и отписка ещё раз проверяются перед отправкой.
 */
export async function planRecipients(selection: AudienceSelection, channels: MailingChannels): Promise<RecipientPlan> {
  const [users, contacts] = await Promise.all([
    selection.userIds.length
      ? db.user.findMany({
          where: { ...audienceUserWhere(), id: { in: selection.userIds } },
          select: {
            id: true,
            name: true,
            email: true,
            contactEmail: true,
            organizationId: true,
            telegramChatId: true,
            marketingOptOut: true,
            createdAt: true,
            organization: { select: { name: true, type: true } },
            _count: {
              select: { webPushSubscriptions: true, mobileDevices: { where: { pushEnabled: true } } },
            },
          },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    selection.contactIds.length
      ? db.marketingContact.findMany({ where: { id: { in: selection.contactIds } }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
  ]);

  const allEmails = [
    ...users.map((u) => userMarketingEmail(u)),
    ...contacts.map((c) => c.email),
  ].filter((e): e is string => Boolean(e));
  // Стоп-лист: адрес → причина. Отписка, жалоба и ручная блокировка
  // останавливают рекламу во всех каналах, «не принимает почту» — только письмо.
  const suppressed = new Map(
    allEmails.length
      ? (
          await db.emailSuppression.findMany({ where: { email: { in: allEmails } }, select: { email: true, reason: true } })
        ).map((r): [string, string] => [r.email, r.reason])
      : []
  );
  const avail = pushAvailability();
  const bot = telegramBotConfigured();
  const stats: PlanStats = {
    selectedUsers: selection.userIds.length,
    selectedContacts: selection.contactIds.length,
    users: users.length,
    contacts: 0,
    missing: selection.userIds.length - users.length,
    duplicates: 0,
    notApplicable: 0,
    recipients: 0,
    channels: {
      email: { queued: 0, noEmail: 0, suppressed: 0, optedOut: 0, inactiveContact: 0 },
      inApp: { queued: 0, optedOut: 0 },
      push: {
        queued: 0,
        skipped: 0,
        optedOut: 0,
        webSubs: 0,
        appDevices: 0,
        webConfigured: avail.webConfigured,
        appConfigured: avail.appConfigured,
      },
      telegram: { queued: 0, skipped: 0, optedOut: 0, botConfigured: bot },
    },
  };

  const drafts: RecipientDraft[] = [];
  const seenEmails = new Set<string>();
  const push = (draft: Omit<RecipientDraft, "id" | "token" | "status">) => {
    const id = newRecipientId();
    const status = overallRecipientStatus([draft.emailStatus, draft.inAppStatus, draft.pushStatus, draft.telegramStatus]);
    drafts.push({ ...draft, id, token: signRecipientToken(id), status });
  };

  for (const u of users) {
    const email = userMarketingEmail(u);
    if (email) seenEmails.add(email);
    const d = { ...emptyDraft(), userId: u.id, email, name: u.name, companyName: u.organization.name };
    d.sphere = normalizeSphere(u.organization.type);
    d.organizationId = u.organizationId;
    if (channels.email) {
      if (!email) {
        d.emailStatus = "skipped";
        d.emailError = "Нет адреса почты";
        stats.channels.email.noEmail += 1;
      } else if (suppressed.has(email)) {
        d.emailStatus = "skipped";
        d.emailError = "Адрес в стоп-листе";
        stats.channels.email.suppressed += 1;
      } else if (u.marketingOptOut) {
        d.emailStatus = "skipped";
        d.emailError = "Отписался от новостей и предложений";
        stats.channels.email.optedOut += 1;
      } else {
        d.emailStatus = "queued";
        stats.channels.email.queued += 1;
      }
    }
    // Отписка от рекламы — во всех каналах (перед отправкой проверяется ещё раз).
    const stop = email ? suppressed.get(email) : undefined;
    const optOut =
      stop && stop !== "bounced" ? "Адрес в стоп-листе" : u.marketingOptOut ? "Отписался от новостей и предложений" : null;
    if (channels.inApp) {
      d.inAppStatus = optOut ? "skipped" : "queued";
      d.inAppError = optOut;
      if (optOut) stats.channels.inApp.optedOut += 1;
      else stats.channels.inApp.queued += 1;
    }
    stats.channels.push.webSubs += u._count.webPushSubscriptions > 0 ? 1 : 0;
    stats.channels.push.appDevices += u._count.mobileDevices > 0 ? 1 : 0;
    if (channels.push) {
      const reason = optOut ?? pushSkipReason(avail, u._count.webPushSubscriptions, u._count.mobileDevices);
      d.pushStatus = reason ? "skipped" : "queued";
      d.pushError = reason;
      if (optOut) stats.channels.push.optedOut += 1;
      if (reason) stats.channels.push.skipped += 1;
      else stats.channels.push.queued += 1;
    }
    if (channels.telegram) {
      const reason = optOut ?? (!u.telegramChatId ? "Telegram не привязан" : !bot ? "Бот Telegram не настроен" : null);
      d.telegramStatus = reason ? "skipped" : "queued";
      d.telegramError = reason;
      if (optOut) stats.channels.telegram.optedOut += 1;
      if (reason) stats.channels.telegram.skipped += 1;
      else stats.channels.telegram.queued += 1;
    }
    push(d);
  }

  for (const c of contacts) {
    if (seenEmails.has(c.email)) {
      stats.duplicates += 1;
      continue;
    }
    seenEmails.add(c.email);
    if (!channels.email) {
      stats.notApplicable += 1;
      continue;
    }
    stats.contacts += 1;
    const d = { ...emptyDraft(), contactId: c.id, email: c.email, name: c.name, companyName: c.company, sphere: c.sphere };
    if (c.status !== "active") {
      d.emailStatus = "skipped";
      d.emailError =
        c.status === "unsubscribed" ? "Контакт отписался" : c.status === "bounced" ? "Адрес не принимает почту" : "Контакт пожаловался на спам";
      stats.channels.email.inactiveContact += 1;
    } else if (suppressed.has(c.email)) {
      d.emailStatus = "skipped";
      d.emailError = "Адрес в стоп-листе";
      stats.channels.email.suppressed += 1;
    } else {
      d.emailStatus = "queued";
      stats.channels.email.queued += 1;
    }
    push(d);
  }
  stats.missing += selection.contactIds.length - contacts.length;
  stats.recipients = drafts.length;
  return { drafts, stats };
}

const ALL_CHANNELS: MailingChannels = { email: true, inApp: true, push: true, telegram: true };

/** Охват по каждому каналу — для галочек формы (считается по всем каналам сразу). */
export async function reachForSelection(selection: AudienceSelection): Promise<PlanStats> {
  return (await planRecipients(selection, ALL_CHANNELS)).stats;
}

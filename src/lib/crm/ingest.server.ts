import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { normalizeEmail, phoneKey } from "@/lib/crm/identity";
import type { CrmIdentity, CrmIngestItem } from "@/lib/crm/sources";
import { awaitingChannel, computeContactState } from "@/lib/crm/state";
import { DEFAULT_ORG_NAME } from "@/lib/org-profile";

/**
 * Запись в CRM: склейка контакта, лента, пересчёт состояния. Всё сводится
 * к одному входу — `ingestCrmItems`: его зовут сбор источников, почта и
 * действия в карточке, поэтому правила одинаковы для всех каналов.
 */

/** Каналы поддержки и звонки: если это пользователь платформы — он клиент, а не лид. */
const SUPPORT_CHANNELS = new Set(["chat", "feedback", "telegram", "call", "missed_call", "call_attempt"]);

export type IngestedItem = { item: CrmIngestItem; contactId: string | null; isNewContact: boolean };

export type IngestResult = {
  created: number;
  skipped: number;
  contactsCreated: number;
  items: IngestedItem[];
};

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

type ContactMatch = {
  id: string;
  email: string | null;
  phoneKey: string | null;
  telegramChatId: string | null;
  userId: string | null;
  name: string | null;
  company: string | null;
  phone: string | null;
  organizationId: string | null;
};

const MATCH_SELECT = {
  id: true,
  email: true,
  phoneKey: true,
  telegramChatId: true,
  userId: true,
  name: true,
  company: true,
  phone: true,
  organizationId: true,
} as const;

/**
 * Пользователь платформы с этой почтой или телефоном — чтобы показать организацию.
 * Телефон сравниваем по последним 10 цифрам: в старых профилях он записан
 * как ввели («8 (993) 917-32-79»), а звонок приходит как «+79939173279».
 */
async function findPlatformUser(email: string | null, key: string | null) {
  const select = { id: true, organizationId: true, name: true, organization: { select: { name: true } } } as const;
  if (email) {
    const byEmail = await db.user.findFirst({
      where: {
        OR: [{ email: { equals: email, mode: "insensitive" } }, { contactEmail: { equals: email, mode: "insensitive" } }],
        archivedAt: null,
        isRoot: false,
      },
      orderBy: { createdAt: "asc" },
      select,
    });
    if (byEmail) return byEmail;
  }
  if (!key) return null;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User"
    WHERE "archivedAt" IS NULL AND "isRoot" = false AND phone IS NOT NULL
      AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = ${key}
    ORDER BY "createdAt" ASC
    LIMIT 1`;
  return rows[0] ? db.user.findUnique({ where: { id: rows[0].id }, select }) : null;
}

/**
 * Контакт по ключам: почта → телефон → Telegram → пользователь. Найденному
 * дописываем пустые поля; не найденный создаём (если можно).
 */
export async function resolveCrmContact(
  identity: CrmIdentity,
  options: { create: boolean; source: string; occurredAt: Date },
): Promise<{ id: string; created: boolean } | null> {
  const email = normalizeEmail(identity.email);
  const key = phoneKey(identity.phone);
  const telegram = identity.telegramChatId?.trim() || null;
  const userId = identity.userId?.trim() || null;
  const or: Prisma.CrmContactWhereInput[] = [];
  if (email) or.push({ email });
  if (key) or.push({ phoneKey: key });
  if (telegram) or.push({ telegramChatId: telegram });
  if (userId) or.push({ userId });

  if (or.length) {
    const candidates: ContactMatch[] = await db.crmContact.findMany({ where: { OR: or }, orderBy: { createdAt: "asc" }, take: 10, select: MATCH_SELECT });
    const found =
      (email && candidates.find((row) => row.email === email)) ||
      (key && candidates.find((row) => row.phoneKey === key)) ||
      (telegram && candidates.find((row) => row.telegramChatId === telegram)) ||
      (userId && candidates.find((row) => row.userId === userId)) ||
      null;
    if (found) {
      const patch: Prisma.CrmContactUpdateInput = {};
      if (!found.email && email) patch.email = email;
      if (!found.phoneKey && key) {
        patch.phone = identity.phone?.trim() ?? null;
        patch.phoneKey = key;
      }
      if (!found.telegramChatId && telegram) patch.telegramChatId = telegram;
      if (!found.userId && userId) patch.userId = userId;
      if (!found.organizationId && identity.organizationId) patch.organizationId = identity.organizationId;
      if (!found.name && identity.name?.trim()) patch.name = identity.name.trim().slice(0, 200);
      if (
        (!found.company || found.company === DEFAULT_ORG_NAME) &&
        identity.company?.trim() &&
        identity.company.trim() !== DEFAULT_ORG_NAME
      ) {
        patch.company = identity.company.trim().slice(0, 300);
      }
      // Контакт ещё не узнан (например, первым был звонок) — ищем пользователя платформы по почте и телефону.
      if (!found.userId && !userId && !found.organizationId && !identity.organizationId) {
        const platformUser = await findPlatformUser(email ?? found.email, key ?? found.phoneKey);
        if (platformUser) {
          patch.userId = platformUser.id;
          patch.organizationId = platformUser.organizationId;
          if (!found.name && !patch.name && platformUser.name) patch.name = platformUser.name;
          if (!found.company && !patch.company) patch.company = platformUser.organization.name;
        }
      }
      if (Object.keys(patch).length) await db.crmContact.update({ where: { id: found.id }, data: patch });
      return { id: found.id, created: false };
    }
  }

  if (!options.create || !or.length) return null;
  const platformUser = !userId || !identity.organizationId ? await findPlatformUser(email, key) : null;
  const organizationId = identity.organizationId ?? platformUser?.organizationId ?? null;
  // Клиент закреплён за менеджером — его новый контакт сразу его.
  const accountManagerId = organizationId
    ? ((await db.organization.findUnique({ where: { id: organizationId }, select: { accountManagerId: true } }))?.accountManagerId ?? null)
    : null;
  const created = await db.crmContact.create({
    data: {
      name: identity.name?.trim().slice(0, 200) || platformUser?.name || null,
      company: identity.company?.trim().slice(0, 300) || platformUser?.organization.name || null,
      email,
      phone: key ? (identity.phone?.trim() ?? null) : null,
      phoneKey: key,
      telegramChatId: telegram,
      userId: userId ?? platformUser?.id ?? null,
      organizationId,
      // Пишет в поддержку пользователь платформы — это клиент, а не лид.
      stage: organizationId && SUPPORT_CHANNELS.has(options.source) ? "won" : "new",
      ownerId: accountManagerId,
      source: options.source,
      lastActivityAt: options.occurredAt,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

/** Пересчёт «кто последний писал / ждёт ли ответа» по ленте контакта. */
export async function recomputeCrmContact(contactId: string): Promise<void> {
  const items = await db.crmInteraction.findMany({
    where: { contactId, filteredReason: null },
    select: { direction: true, channel: true, occurredAt: true },
  });
  const state = computeContactState(items);
  await db.crmContact.update({
    where: { id: contactId },
    data: {
      lastInboundAt: state.lastInboundAt,
      lastOutboundAt: state.lastOutboundAt,
      ...(state.lastActivityAt ? { lastActivityAt: state.lastActivityAt } : {}),
      awaitingSince: state.awaitingSince,
      awaitingChannel: awaitingChannel(items, state.awaitingSince),
    },
  });
}

/**
 * Записывает пачку. Уже записанные ключи пропускает (сбор идёт с нахлёстом),
 * гонку двух прогонов ловит уникальный `externalKey`. Отказ, снова написавший
 * нам, возвращается «В работу»: иначе CRM молчала бы о живом клиенте.
 */
export async function ingestCrmItems(items: readonly CrmIngestItem[]): Promise<IngestResult> {
  const result: IngestResult = { created: 0, skipped: 0, contactsCreated: 0, items: [] };
  if (!items.length) return result;
  const known = new Set(
    (await db.crmInteraction.findMany({ where: { externalKey: { in: items.map((item) => item.externalKey) } }, select: { externalKey: true } })).map(
      (row) => row.externalKey,
    ),
  );
  const touched = new Set<string>();
  const ordered = [...items].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  for (const item of ordered) {
    if (known.has(item.externalKey)) {
      result.skipped += 1;
      continue;
    }
    known.add(item.externalKey);
    let contactId: string | null = null;
    let isNewContact = false;
    if (item.contactId) {
      contactId = item.contactId;
    } else if (!item.filteredReason) {
      const contact = await resolveCrmContact(item.identity, { create: item.createContact !== false, source: item.channel, occurredAt: item.occurredAt });
      if (!contact) {
        result.skipped += 1;
        continue;
      }
      contactId = contact.id;
      isNewContact = contact.created;
      if (contact.created) result.contactsCreated += 1;
    }
    try {
      await db.crmInteraction.create({
        data: {
          contactId,
          channel: item.channel,
          direction: item.direction,
          subject: item.subject?.slice(0, 500) ?? null,
          body: item.body,
          externalKey: item.externalKey,
          href: item.href ?? null,
          fromAddress: item.fromAddress ?? null,
          fromName: item.fromName?.slice(0, 200) ?? null,
          filteredReason: item.filteredReason ?? null,
          authorUserId: item.authorUserId ?? null,
          authorName: item.authorName?.slice(0, 200) ?? null,
          occurredAt: item.occurredAt,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        result.skipped += 1;
        continue;
      }
      throw error;
    }
    result.created += 1;
    result.items.push({ item, contactId, isNewContact });
    if (contactId) {
      touched.add(contactId);
      if (item.direction === "in") {
        await db.crmContact.updateMany({ where: { id: contactId, stage: "lost" }, data: { stage: "in_work" } });
      }
    }
  }
  for (const contactId of touched) await recomputeCrmContact(contactId);
  return result;
}

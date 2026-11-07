import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";
import { CRM_ESCALATION_MS, CRM_SILENT_AFTER_MS, CRM_SILENT_GIVE_UP_MS, QUIET_STAGES } from "@/lib/crm/constants";
import type { IngestedItem } from "@/lib/crm/ingest.server";
import { previewLine } from "@/lib/crm/mail-text";
import {
  composeDigest,
  composeNewMailAlert,
  composeReminder,
  isDigestTime,
  isWorkingTime,
  moscowDateKey,
  planReminders,
  type ReminderContact,
} from "@/lib/crm/reminders";
import { getPlatformAdministrators } from "@/lib/platform-admin";
import { sendTelegramMessage } from "@/lib/telegram";

/**
 * Кому и как CRM напоминает. Получатели — все РОП (`User.platformSalesHead`)
 * и ответственный; РОП не назначен — администраторы платформы, чтобы ничего
 * не потерялось. Канал — Telegram, если привязан, иначе почта.
 *
 * Отправка «забрал — отправил»: сначала строка `CrmReminderLog` с
 * уникальным ключом, потом сообщение. Два одновременных прогона (крон и
 * кнопка) не пришлют одно напоминание дважды.
 */

const APP_URL = () => process.env.NEXTAUTH_URL || "https://wesetup.ru";

type Recipient = { id: string | null; email: string | null; telegramChatId: string | null };

export async function listSalesHeads(): Promise<{ id: string; name: string; email: string; telegramChatId: string | null }[]> {
  return db.user.findMany({
    where: { platformSalesHead: true, isActive: true, archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, telegramChatId: true },
  });
}

async function recipientsFor(args: { ownerId: string | null; toOwner: boolean; toHeads: boolean }): Promise<Recipient[]> {
  const list = new Map<string, Recipient>();
  if (args.toHeads) {
    for (const head of await listSalesHeads()) list.set(head.id, { id: head.id, email: head.email, telegramChatId: head.telegramChatId });
  }
  if (args.toOwner && args.ownerId) {
    const owner = await db.user.findFirst({
      where: { id: args.ownerId, isActive: true, archivedAt: null },
      select: { id: true, email: true, contactEmail: true, telegramChatId: true },
    });
    if (owner) list.set(owner.id, { id: owner.id, email: owner.contactEmail || owner.email, telegramChatId: owner.telegramChatId });
  }
  if (list.size === 0) {
    // Ни РОП, ни ответственного — пусть узнают администраторы.
    for (const admin of await getPlatformAdministrators("admins")) list.set(admin.email, { id: null, email: admin.email, telegramChatId: admin.telegramChatId });
  }
  return [...list.values()];
}

async function deliver(recipients: Recipient[], message: { subject: string; text: string }, kind: string, dedupeKey: string, both = false): Promise<number> {
  let delivered = 0;
  for (const recipient of recipients) {
    let ok = false;
    if (recipient.telegramChatId) {
      ok = await sendTelegramMessage(recipient.telegramChatId, message.text, { delivery: { kind: `crm:${kind}`, dedupeKey } }).catch((error: unknown) => {
        console.error("[crm] Telegram не ушёл", error);
        return false;
      });
    }
    if ((both || !ok) && recipient.email) {
      const html = renderEmailLayout(escapeHtml(message.subject), `<div style="color:#3f3f46;font-size:14px;line-height:1.6;white-space:pre-line">${message.text}</div>`, null, {
        preheader: message.subject,
      });
      const mailed = await sendRawEmail(recipient.email, message.subject, html).catch((error: unknown) => {
        console.error("[crm] письмо не ушло", error);
        return false;
      });
      ok = ok || mailed;
    }
    if (ok) delivered += 1;
  }
  return delivered;
}

/**
 * Итог отправки: дошло — записываем число получателей; не дошло ни до кого
 * (Telegram и почта упали) — снимаем ключ, следующий прогон попробует снова.
 */
async function settle(logId: string, delivered: number): Promise<void> {
  if (delivered > 0) await db.crmReminderLog.update({ where: { id: logId }, data: { recipients: delivered } }).catch(() => undefined);
  else await db.crmReminderLog.delete({ where: { id: logId } }).catch(() => undefined);
}

/** id строки — ключ наш, можно отправлять; null — уже отправлено другим прогоном. */
async function claim(dedupeKey: string, kind: string, contactId: string | null): Promise<string | null> {
  try {
    const row = await db.crmReminderLog.create({ data: { dedupeKey, kind, contactId }, select: { id: true } });
    return row.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

const REMINDER_SELECT = {
  id: true,
  name: true,
  company: true,
  email: true,
  phone: true,
  stage: true,
  ownerId: true,
  awaitingSince: true,
  awaitingChannel: true,
  lastInboundAt: true,
  lastOutboundAt: true,
  nextActionAt: true,
  nextActionNote: true,
} as const;

export async function runCrmReminders(now = new Date()): Promise<{ planned: number; sent: number }> {
  if (!isWorkingTime(now)) return { planned: 0, sent: 0 };
  const contacts: ReminderContact[] = await db.crmContact.findMany({
    where: {
      stage: { notIn: [...QUIET_STAGES] },
      OR: [
        { awaitingSince: { not: null } },
        { nextActionAt: { lte: now } },
        {
          awaitingSince: null,
          nextActionAt: null,
          stage: { in: ["new", "in_work"] },
          lastOutboundAt: { lte: new Date(now.getTime() - CRM_SILENT_AFTER_MS), gte: new Date(now.getTime() - CRM_SILENT_GIVE_UP_MS) },
        },
      ],
    },
    take: 2000,
    select: REMINDER_SELECT,
  });
  const plan = planReminders(contacts, now);
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const ownerIds = [...new Set(contacts.map((contact) => contact.ownerId).filter((id): id is string => Boolean(id)))];
  const owners = new Map((await db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })).map((user) => [user.id, user.name]));
  let sent = 0;
  for (const item of plan) {
    const contact = byId.get(item.contactId);
    if (!contact) continue;
    const logId = await claim(item.dedupeKey, item.kind, contact.id);
    if (!logId) continue;
    const message = composeReminder({
      kind: item.kind,
      contact,
      now,
      appUrl: APP_URL(),
      ownerName: contact.ownerId ? (owners.get(contact.ownerId) ?? null) : null,
      escape: escapeHtml,
    });
    const recipients = await recipientsFor({ ownerId: contact.ownerId, toOwner: item.toOwner, toHeads: item.toHeads });
    const delivered = await deliver(recipients, message, item.kind, item.dedupeKey);
    await settle(logId, delivered);
    if (delivered) sent += 1;
  }
  return { planned: plan.length, sent };
}

/**
 * Новое письмо в ящик CRM: новый лид — РОП, ответ по контакту — его
 * ответственному (нет — РОП). Ночью не будим: утром сработает «нет ответа».
 */
export async function notifyNewMail(ingested: readonly IngestedItem[], now = new Date()): Promise<number> {
  if (!isWorkingTime(now)) return 0;
  const accepted = ingested.filter((entry) => entry.contactId && !entry.item.filteredReason && entry.item.direction === "in");
  let sent = 0;
  for (const entry of accepted) {
    const contact = await db.crmContact.findUnique({ where: { id: entry.contactId! }, select: { id: true, ownerId: true, stage: true } });
    if (!contact || contact.stage === "spam") continue;
    const dedupeKey = `crm:mail:${entry.item.externalKey}`;
    const logId = await claim(dedupeKey, "new_mail", contact.id);
    if (!logId) continue;
    const message = composeNewMailAlert({
      contactId: contact.id,
      isNewContact: entry.isNewContact,
      fromName: entry.item.fromName ?? null,
      fromAddress: entry.item.fromAddress ?? "",
      subject: entry.item.subject ?? null,
      preview: previewLine(entry.item.body, 300),
      appUrl: APP_URL(),
      escape: escapeHtml,
    });
    const recipients = await recipientsFor({ ownerId: contact.ownerId, toOwner: !entry.isNewContact, toHeads: entry.isNewContact || !contact.ownerId });
    const delivered = await deliver(recipients, message, "new_mail", dedupeKey);
    await settle(logId, delivered);
    if (delivered) sent += 1;
  }
  return sent;
}

/** Цифры для сводки и экрана CRM. */
export async function loadDigestData(now = new Date()) {
  const day = 24 * 60 * 60 * 1000;
  const dayStart = new Date(now.getTime() - day);
  // Конец текущих суток по Москве (UTC+3): «шаги на сегодня».
  const moscowMidnight = new Date(`${moscowDateKey(now)}T00:00:00+03:00`);
  const endOfDay = new Date(moscowMidnight.getTime() + day);
  const active = { stage: { notIn: [...QUIET_STAGES] } };
  const [awaiting, overdue, newContacts, nextToday, nextOverdue, silent, filtered] = await Promise.all([
    db.crmContact.count({ where: { ...active, awaitingSince: { not: null } } }),
    db.crmContact.count({ where: { ...active, awaitingSince: { lte: new Date(now.getTime() - CRM_ESCALATION_MS) } } }),
    db.crmContact.groupBy({ by: ["source"], where: { createdAt: { gte: dayStart }, stage: { not: "spam" } }, _count: { _all: true } }),
    db.crmContact.count({ where: { ...active, nextActionAt: { gt: now, lt: endOfDay } } }),
    db.crmContact.count({ where: { ...active, nextActionAt: { lte: now } } }),
    db.crmContact.count({
      where: {
        stage: { in: ["new", "in_work"] },
        awaitingSince: null,
        nextActionAt: null,
        lastOutboundAt: { lte: new Date(now.getTime() - CRM_SILENT_AFTER_MS), gte: new Date(now.getTime() - CRM_SILENT_GIVE_UP_MS) },
      },
    }),
    db.crmInteraction.count({ where: { filteredReason: { not: null }, createdAt: { gte: dayStart } } }),
  ]);
  const newByChannel = newContacts.map((row) => ({ channel: row.source, count: row._count._all })).sort((a, b) => b.count - a.count);
  return {
    dateLabel: new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(now),
    awaiting,
    overdue,
    newLeads: newByChannel.reduce((sum, item) => sum + item.count, 0),
    newByChannel,
    nextToday,
    nextOverdue,
    silent,
    filtered,
  };
}

/** Утренняя сводка — раз в день, первым прогоном после 9:00 по Москве. */
export async function runCrmDigest(now = new Date()): Promise<boolean> {
  if (!isDigestTime(now)) return false;
  const dedupeKey = `crm:digest:${moscowDateKey(now)}`;
  const logId = await claim(dedupeKey, "digest", null);
  if (!logId) return false;
  const message = composeDigest(await loadDigestData(now), APP_URL(), escapeHtml);
  const recipients = await recipientsFor({ ownerId: null, toOwner: false, toHeads: true });
  const delivered = await deliver(recipients, message, "digest", dedupeKey, true);
  await settle(logId, delivered);
  return delivered > 0;
}

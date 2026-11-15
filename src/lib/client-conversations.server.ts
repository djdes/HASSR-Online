import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { normalizeEmail, phoneKey } from "@/lib/crm/identity";
import type { ClientContacts } from "@/lib/root-client-card.server";

/**
 * «Переписки» в карточке клиента панели: вся лента общения с клиентом по
 * времени — письма (входящие из почтовых ящиков CRM и наши ответы),
 * письма из карточки клиента, звонки Телфина с записью и расшифровкой,
 * онлайн-чат, Telegram и MAX, заметки менеджеров.
 *
 * Источник — лента CRM (`CrmInteraction`) по всем контактам CRM этого
 * клиента: привязанным к организации и найденным по почтам и телефонам
 * её людей и компании. Плюс `ClientEmail` (письма из карточки), если
 * такого письма ещё нет в ленте CRM.
 */
export type ConversationItem = {
  id: string;
  source: "crm" | "client-email";
  /** Контакт CRM — для плеера записи и ссылки в CRM. */
  contactId: string | null;
  contactName: string | null;
  channel: string;
  /** in | out | note | event */
  direction: string;
  subject: string | null;
  body: string;
  authorName: string | null;
  fromAddress: string | null;
  href: string | null;
  occurredAt: string;
  call: {
    id: string;
    audio: boolean;
    audioStatus: string;
    durationSec: number;
    transcript: string | null;
    transcriptStatus: string;
    flow: string;
    employeeName: string | null;
  } | null;
  status?: string | null;
};

export type ClientConversations = {
  items: ConversationItem[];
  contacts: { id: string; name: string | null; email: string | null; phone: string | null }[];
  truncated: boolean;
};

const LIMIT = 400;

/** Почты и телефоны клиента, по которым ищем контакты CRM (без технических логинов). */
export function clientIdentityKeys(contacts: ClientContacts | null): { emails: string[]; phoneKeys: string[] } {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const addEmail = (value: string | null | undefined) => {
    const email = normalizeEmail(value);
    if (email) emails.add(email);
  };
  const addPhone = (value: string | null | undefined) => {
    const key = phoneKey(value);
    if (key) phones.add(key);
  };
  for (const person of contacts?.people ?? []) {
    if (person.isRoot) continue;
    addEmail(person.email);
    addEmail(person.loginEmail);
    addPhone(person.phone);
  }
  for (const email of contacts?.company.emails ?? []) addEmail(email);
  addEmail(contacts?.company.accountantEmail);
  for (const phone of contacts?.company.phones ?? []) addPhone(phone);
  return { emails: [...emails], phoneKeys: [...phones] };
}

function messageIdKey(value: string | null | undefined): string | null {
  const id = value?.trim().replace(/^<|>$/g, "").toLowerCase();
  return id || null;
}

export async function loadClientConversations(organizationId: string, contacts: ClientContacts | null): Promise<ClientConversations> {
  const { emails, phoneKeys } = clientIdentityKeys(contacts);
  const or: Prisma.CrmContactWhereInput[] = [{ organizationId }];
  if (emails.length) or.push({ email: { in: emails } });
  if (phoneKeys.length) or.push({ phoneKey: { in: phoneKeys } });

  const crmContacts = await db.crmContact.findMany({
    where: { OR: or, stage: { not: "spam" } },
    select: { id: true, name: true, company: true, email: true, phone: true },
    take: 50,
  });
  const contactIds = crmContacts.map((contact) => contact.id);
  const nameOf = new Map(crmContacts.map((contact) => [contact.id, contact.name || contact.company || contact.email || contact.phone]));

  const [interactions, clientEmails] = await Promise.all([
    contactIds.length
      ? db.crmInteraction.findMany({
          where: { contactId: { in: contactIds }, filteredReason: null },
          orderBy: { occurredAt: "desc" },
          take: LIMIT + 1,
          include: {
            call: {
              select: { id: true, audioStatus: true, durationSec: true, transcript: true, transcriptStatus: true, flow: true, employeeName: true },
            },
          },
        })
      : Promise.resolve([]),
    db.clientEmail.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, to: true, subject: true, message: true, senderName: true, fromEmail: true, status: true, error: true, messageId: true, createdAt: true, sentAt: true },
    }),
  ]);

  // Письмо из карточки клиента уже могло попасть в ленту CRM (копия из
  // «Отправленных» ящика) — тогда показываем один раз.
  const crmMessageIds = new Set(
    interactions.map((item) => /^email(?:-out)?:(.+?)(?::[^:@]+@[^:]+)?$/.exec(item.externalKey)?.[1]).map(messageIdKey).filter(Boolean),
  );

  const items: ConversationItem[] = interactions.slice(0, LIMIT).map((item) => ({
    id: item.id,
    source: "crm",
    contactId: item.contactId,
    contactName: item.contactId ? (nameOf.get(item.contactId) ?? null) : null,
    channel: item.channel,
    direction: item.direction,
    subject: item.subject,
    body: item.body,
    authorName: item.authorName,
    fromAddress: item.fromAddress,
    href: item.href,
    occurredAt: item.occurredAt.toISOString(),
    call: item.call
      ? {
          id: item.call.id,
          audio: item.call.audioStatus === "ready",
          audioStatus: item.call.audioStatus,
          durationSec: item.call.durationSec,
          transcript: item.call.transcript,
          transcriptStatus: item.call.transcriptStatus,
          flow: item.call.flow,
          employeeName: item.call.employeeName,
        }
      : null,
  }));

  for (const mail of clientEmails) {
    const key = messageIdKey(mail.messageId);
    if (key && crmMessageIds.has(key)) continue;
    items.push({
      id: `client-email:${mail.id}`,
      source: "client-email",
      contactId: null,
      contactName: mail.to,
      channel: "email",
      direction: "out",
      subject: mail.subject,
      body: mail.message,
      authorName: mail.senderName,
      fromAddress: mail.fromEmail,
      href: null,
      occurredAt: (mail.sentAt ?? mail.createdAt).toISOString(),
      call: null,
      status: mail.status === "failed" ? `не отправлено${mail.error ? `: ${mail.error}` : ""}` : mail.status === "sending" ? "отправляется" : null,
    });
  }

  items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return {
    items,
    contacts: crmContacts.map((contact) => ({ id: contact.id, name: contact.name || contact.company, email: contact.email, phone: contact.phone })),
    truncated: interactions.length > LIMIT,
  };
}

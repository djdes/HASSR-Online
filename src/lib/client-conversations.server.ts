import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { normalizeEmail, phoneKey } from "@/lib/crm/identity";
import type { ClientContacts } from "@/lib/root-client-card.server";
import { clientEmailMessageId } from "@/lib/client-email";

/**
 * «Переписки» в карточке клиента панели: вся лента общения с клиентом по
 * времени — письма (входящие из почтовых ящиков CRM и наши ответы),
 * письма из карточки клиента, звонки Телфина с записью и расшифровкой,
 * онлайн-чат, Telegram и MAX, заметки менеджеров.
 *
 * Источник — лента CRM (`CrmInteraction`) по всем контактам CRM этого
 * клиента: привязанным к организации и найденным по почтам и телефонам
 * её людей и компании. Плюс `ClientEmail` (письма из карточки и раздела
 * «Письма»), журнал исходящих писем `OutgoingEmail` (автоматические письма
 * сайта и письма сотрудников) и рассылки (`MailingRecipient`) — по
 * организации и по почтам людей клиента. Одно письмо (один Message-ID)
 * показывается один раз.
 */
export type ConversationItem = {
  id: string;
  /** crm — лента CRM; client-email — «Письма клиенту»; outgoing-email — журнал писем сайта и сотрудников; mailing — рассылка. */
  source: "crm" | "client-email" | "outgoing-email" | "mailing";
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
  /** Письмо отправил сайт сам (напоминание, приветствие, счёт), а не сотрудник. */
  automatic?: boolean;
  /** Текст письма не сохранён: в нём был код, пароль или ссылка входа. */
  hiddenBody?: boolean;
  /** Имена вложений. */
  attachments?: string[];
};

export type ClientConversations = {
  items: ConversationItem[];
  contacts: { id: string; name: string | null; email: string | null; phone: string | null }[];
  truncated: boolean;
};

const LIMIT = 400;
/** Сколько писем журнала (`OutgoingEmail`) и рассылок показываем. */
const OUTGOING_LIMIT = 300;
const MAILING_LIMIT = 100;

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

function attachmentNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.flatMap((item) => (item && typeof item === "object" && typeof (item as { filename?: unknown }).filename === "string" ? [(item as { filename: string }).filename] : []));
  return names.length ? names : undefined;
}

function failedStatus(status: string, error: string | null | undefined): string | null {
  if (status === "failed") return `не отправлено${error ? `: ${error}` : ""}`;
  if (status === "sending") return "отправляется";
  return null;
}

/** Тема и текст рассылки из `payload` кампании (у шаблонов они называются одинаково). */
function mailingContent(payload: unknown, title: string): { subject: string; body: string } {
  const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const subject = typeof data.subject === "string" && data.subject.trim() ? data.subject.trim() : title;
  const body = typeof data.body === "string" ? data.body.trim() : typeof data.text === "string" ? data.text.trim() : "";
  return { subject, body };
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

  // Письма ищем и по организации, и по почтам людей клиента: письмо с
  // раздела «Письма» на введённый вручную адрес лежит под платформой.
  const byOrgOrEmail = <K extends string>(emailField: K) =>
    emails.length ? [{ organizationId }, { [emailField]: { in: emails } } as Record<K, { in: string[] }>] : [{ organizationId }];

  const [interactions, clientEmails, outgoing, mailings] = await Promise.all([
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
      where: { OR: byOrgOrEmail("to") },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, to: true, subject: true, message: true, senderName: true, fromEmail: true, status: true, error: true, messageId: true, attachmentsJson: true, createdAt: true, sentAt: true },
    }),
    db.outgoingEmail.findMany({
      where: { OR: byOrgOrEmail("to") },
      orderBy: { createdAt: "desc" },
      take: OUTGOING_LIMIT + 1,
      select: { id: true, to: true, via: true, fromEmail: true, senderUserId: true, subject: true, text: true, attachmentsJson: true, status: true, error: true, messageId: true, createdAt: true },
    }),
    db.mailingRecipient.findMany({
      where: { isTest: false, emailStatus: { in: ["sent", "failed"] }, OR: byOrgOrEmail("email") },
      orderBy: { createdAt: "desc" },
      take: MAILING_LIMIT,
      select: { id: true, email: true, emailStatus: true, emailError: true, emailSentAt: true, createdAt: true, campaign: { select: { id: true, title: true, payload: true } } },
    }),
  ]);
  const senderIds = [...new Set(outgoing.flatMap((row) => (row.senderUserId ? [row.senderUserId] : [])))];
  const senders = senderIds.length
    ? new Map((await db.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, name: true } })).map((user) => [user.id, user.name]))
    : new Map<string, string>();

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

  // Письма из карточки уже есть в истории — их копии в журнале не повторяем.
  const shownMessageIds = new Set(crmMessageIds);
  for (const mail of clientEmails) {
    const key = messageIdKey(mail.messageId);
    shownMessageIds.add(messageIdKey(clientEmailMessageId(mail.id)));
    if (key) shownMessageIds.add(key);
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
      status: failedStatus(mail.status, mail.error),
      attachments: attachmentNames(mail.attachmentsJson),
    });
  }

  for (const row of outgoing.slice(0, OUTGOING_LIMIT)) {
    const key = messageIdKey(row.messageId);
    if (key && shownMessageIds.has(key)) continue;
    items.push({
      id: `outgoing-email:${row.id}`,
      source: "outgoing-email",
      contactId: null,
      contactName: row.to,
      channel: "email",
      direction: "out",
      subject: row.subject,
      body: row.text ?? "",
      authorName: row.senderUserId ? (senders.get(row.senderUserId) ?? null) : null,
      fromAddress: row.fromEmail,
      href: null,
      occurredAt: row.createdAt.toISOString(),
      call: null,
      status: failedStatus(row.status, row.error),
      automatic: row.via === "system" && !row.senderUserId,
      hiddenBody: row.text === null,
      attachments: attachmentNames(row.attachmentsJson),
    });
  }

  for (const row of mailings) {
    const { subject, body } = mailingContent(row.campaign.payload, row.campaign.title);
    items.push({
      id: `mailing:${row.id}`,
      source: "mailing",
      contactId: null,
      contactName: row.email,
      channel: "email",
      direction: "out",
      subject,
      body,
      authorName: null,
      fromAddress: null,
      href: `/root/mailing/${encodeURIComponent(row.campaign.id)}`,
      occurredAt: (row.emailSentAt ?? row.createdAt).toISOString(),
      call: null,
      status: failedStatus(row.emailStatus ?? "", row.emailError),
      automatic: true,
    });
  }

  items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return {
    items,
    contacts: crmContacts.map((contact) => ({ id: contact.id, name: contact.name || contact.company, email: contact.email, phone: contact.phone })),
    truncated: interactions.length > LIMIT || outgoing.length > OUTGOING_LIMIT,
  };
}

import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { resolveEmailSender } from "@/lib/email-sender-access.server";
import { formatFromAddress } from "@/lib/platform-mail";
import { escapeHtml } from "@/lib/html-escape";
import { CRM_FILTER_REASONS } from "@/lib/crm/constants";
import type { ContactMessageInput, ContactPatch, ManualLeadInput } from "@/lib/crm/forms";
import { normalizeEmail, normalizeRulePattern, phoneKey } from "@/lib/crm/identity";
import { ingestCrmItems, recomputeCrmContact, resolveCrmContact } from "@/lib/crm/ingest.server";
import { staffSender } from "@/lib/client-documents.server";
import { readMailSender, sendStaffEmail } from "@/lib/platform-mail.server";
import { sendTelegramMessage } from "@/lib/telegram";

/**
 * Действия сотрудника в CRM: лид вручную, правка карточки, письмо и
 * Telegram клиенту, звонок, заметка, «ответ не нужен», отсев. Всё, что
 * попадает в ленту, идёт через `ingestCrmItems` — как и сбор.
 */

export class CrmActionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type CrmActor = {
  id: string;
  name: string | null;
  organizationId: string;
  /** Охват «свои» (менеджер): назначает только себя, правила почты не трогает. */
  own?: boolean;
};

async function audit(actor: CrmActor, action: string, entityId: string, details: Record<string, unknown>) {
  await db.auditLog
    .create({ data: { organizationId: actor.organizationId, userId: actor.id, userName: actor.name, action, entity: "crm", entityId, details: details as object } })
    .catch((error) => console.error("[crm] аудит не записан", error));
}

/** Лид из WhatsApp, VK, MAX, звонка — того, чего нет в API. */
export async function createManualLead(input: ManualLeadInput, actor: CrmActor): Promise<string> {
  const now = new Date();
  const identity = { email: input.email || null, phone: input.phone ?? null, name: input.name ?? null, company: input.company ?? null };
  const contact = await resolveCrmContact(identity, { create: true, source: input.channel, occurredAt: now });
  if (!contact) throw new CrmActionError("Нужен телефон или почта");
  if (actor.own && !contact.created) {
    const existing = await db.crmContact.findUnique({ where: { id: contact.id }, select: { ownerId: true } });
    if (existing?.ownerId && existing.ownerId !== actor.id) {
      throw new CrmActionError("Этот клиент уже закреплён за другим менеджером — обратитесь к РОП", 409);
    }
  }
  await ingestCrmItems([
    {
      contactId: contact.id,
      externalKey: `crm:${randomUUID()}`,
      channel: input.channel,
      direction: "in",
      subject: "Лид добавлен вручную",
      body: input.message,
      occurredAt: now,
      authorName: actor.name,
      authorUserId: actor.id,
      identity,
    },
  ]);
  if (contact.created) await db.crmContact.update({ where: { id: contact.id }, data: { ownerId: actor.id } });
  await audit(actor, "crm.lead.create", contact.id, { channel: input.channel, created: contact.created });
  return contact.id;
}

/** Ответственный — только тот, кто видит CRM: владелец, раздел «CRM» или РОП. */
async function assertOwner(ownerId: string) {
  const user = await db.user.findFirst({
    where: { id: ownerId, isActive: true, archivedAt: null, OR: [{ isRoot: true }, { platformSections: { has: "crm" } }, { platformSalesHead: true }] },
    select: { id: true },
  });
  if (!user) throw new CrmActionError("Ответственным можно назначить только сотрудника с разделом «CRM»");
}

export async function updateCrmContact(id: string, patch: ContactPatch, actor: CrmActor): Promise<void> {
  const contact = await db.crmContact.findUnique({ where: { id }, select: { id: true, email: true, stage: true, ownerId: true } });
  if (!contact) throw new CrmActionError("Контакт не найден", 404);
  if (actor.own) {
    // Менеджер: взять свободного себе или отпустить своего; распределяет РОП.
    if (patch.ownerId !== undefined && patch.ownerId !== null && patch.ownerId !== actor.id) {
      throw new CrmActionError("Назначить другого менеджера может РОП", 403);
    }
    if (patch.ownerId === null && contact.ownerId !== actor.id) throw new CrmActionError("Это не ваш клиент", 403);
    if (patch.blockSender) throw new CrmActionError("Стоп-лист почты ведёт РОП — отметьте стадию «Спам»", 403);
  }
  if (patch.ownerId) await assertOwner(patch.ownerId);
  const data: Record<string, unknown> = {};
  if (patch.stage !== undefined) data.stage = patch.stage;
  if (patch.ownerId !== undefined) data.ownerId = patch.ownerId;
  if (patch.nextActionAt !== undefined) data.nextActionAt = patch.nextActionAt ? new Date(patch.nextActionAt) : null;
  if (patch.nextActionNote !== undefined) data.nextActionNote = patch.nextActionNote || null;
  if (patch.name !== undefined) data.name = patch.name || null;
  if (patch.company !== undefined) data.company = patch.company || null;
  if (patch.note !== undefined) data.note = patch.note || null;
  if (patch.email !== undefined) data.email = normalizeEmail(patch.email) ?? null;
  if (patch.phone !== undefined) {
    data.phone = patch.phone || null;
    data.phoneKey = phoneKey(patch.phone);
  }
  if (patch.blockSender) data.stage = "spam";
  await db.crmContact.update({ where: { id }, data });
  const email = (data.email as string | null | undefined) ?? contact.email;
  if (patch.blockSender && email) {
    await db.crmSenderRule.upsert({
      where: { pattern: email },
      create: { pattern: email, action: "block", note: "Спам из карточки CRM", createdById: actor.id },
      update: { action: "block" },
    });
  }
  await audit(actor, "crm.contact.update", id, { fields: Object.keys(data), stage: data.stage ?? contact.stage });
}

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 12px;line-height:1.6">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Подпись письма: своя подпись из «Моей почты» целиком; иначе имя, должность
 * (личная → «Моя почта» → роль — как в КП) и телефон.
 */
async function signatureFor(actor: CrmActor): Promise<string> {
  const mailbox = await readMailSender(actor.id).catch(() => null);
  if (mailbox?.signature.trim()) return mailbox.signature.trim();
  const sender = await staffSender(actor.id).catch(() => null);
  return [sender?.name || actor.name, sender?.position, sender?.phone, "WeSetup — электронные журналы ХАССП"].filter(Boolean).join("\n");
}

export type MessageResult = { ok: true; via?: string; note?: string } | { ok: false; error: string };

export async function addContactMessage(id: string, input: ContactMessageInput, actor: CrmActor): Promise<MessageResult> {
  const contact = await db.crmContact.findUnique({ where: { id }, select: { id: true, email: true, telegramChatId: true, name: true } });
  if (!contact) throw new CrmActionError("Контакт не найден", 404);
  const now = new Date();
  const base = { contactId: id, occurredAt: now, authorName: actor.name, authorUserId: actor.id, identity: {} };

  if (input.kind === "email") {
    if (!contact.email) return { ok: false, error: "У контакта нет почты — добавьте её в карточке" };
    const mailboxUserId = await resolveEmailSender(actor.id, input.mailboxUserId);
    if (!mailboxUserId) return { ok: false, error: "Выбранная почта недоступна для отправки" };
    const selected = input.mailboxUserId ? await readMailSender(mailboxUserId) : null;
    if (input.mailboxUserId && (!selected?.enabled || !selected.verifiedAt)) return { ok: false, error: "Выбранная почта не подключена или не проверена" };
    const messageId = `crm-${randomUUID()}@wesetup.ru`;
    const text = `${input.body}\n\n--\n${await signatureFor({ ...actor, id: mailboxUserId, name: selected?.fromName ?? actor.name })}`;
    const result = await sendStaffEmail({
      senderUserId: mailboxUserId,
      personalOnly: Boolean(input.mailboxUserId),
      expectedFrom: selected ? formatFromAddress(selected.fromName, selected.fromEmail) : undefined,
      to: contact.email,
      subject: input.subject ?? "",
      html: textToHtml(text),
      text,
      messageId: `<${messageId}>`,
    });
    if (!result.ok) return { ok: false, error: result.error };
    await ingestCrmItems([
      { ...base, externalKey: `email-out:${messageId}:${contact.email}`, channel: "email", direction: "out", subject: input.subject ?? null, body: input.body,
        fromAddress: selected?.fromEmail, fromName: selected?.fromName },
    ]);
    return {
      ok: true,
      via: result.via,
      note: result.via === "system" ? `Ушло с общего адреса ${result.from}: ответ клиента придёт на вашу почту${result.fallbackReason ? ` (${result.fallbackReason})` : ""}` : undefined,
    };
  }

  if (input.kind === "telegram") {
    if (!contact.telegramChatId) return { ok: false, error: "Клиент не писал боту — в Telegram ему не написать" };
    const key = `crm:${randomUUID()}`;
    const sent = await sendTelegramMessage(contact.telegramChatId, escapeHtml(input.body), { delivery: { kind: "crm:client_message", dedupeKey: key } }).catch(() => false);
    if (!sent) return { ok: false, error: "Telegram не доставил сообщение — возможно, клиент остановил бота" };
    await ingestCrmItems([{ ...base, externalKey: key, channel: "telegram", direction: "out", body: input.body }]);
    return { ok: true, via: "telegram" };
  }

  const map = {
    call: { channel: "call", direction: "out" as const, subject: "Звонок" },
    note: { channel: "note", direction: "note" as const, subject: null },
    resolved: { channel: "resolved", direction: "note" as const, subject: "Ответ не нужен" },
  }[input.kind];
  await ingestCrmItems([{ ...base, externalKey: `crm:${randomUUID()}`, channel: map.channel, direction: map.direction, subject: map.subject, body: input.body || "Ответ клиенту не требуется" }]);
  return { ok: true };
}

/** Вернуть отсеянное письмо: к контакту (созданному при необходимости), по желанию — с правилом allow. */
export async function restoreFilteredMail(interactionId: string, allowSender: boolean, actor: CrmActor): Promise<string> {
  const row = await db.crmInteraction.findUnique({ where: { id: interactionId } });
  if (!row || !row.filteredReason) throw new CrmActionError("Письмо не найдено среди отсеянных", 404);
  const email = normalizeEmail(row.fromAddress);
  if (!email) throw new CrmActionError("У письма нет адреса отправителя — вернуть некуда");
  const contact = await resolveCrmContact({ email, name: row.fromName }, { create: true, source: "email", occurredAt: row.occurredAt });
  if (!contact) throw new CrmActionError("Не удалось завести контакт");
  await db.crmInteraction.update({ where: { id: row.id }, data: { contactId: contact.id, filteredReason: null } });
  await recomputeCrmContact(contact.id);
  if (allowSender) {
    await db.crmSenderRule.upsert({
      where: { pattern: email },
      create: { pattern: email, action: "allow", note: `Возвращено из «Отсеяно» (${CRM_FILTER_REASONS[row.filteredReason as keyof typeof CRM_FILTER_REASONS] ?? row.filteredReason})`, createdById: actor.id },
      update: { action: "allow" },
    });
  }
  await audit(actor, "crm.mail.restore", row.id, { email, allowSender });
  return contact.id;
}

export async function addSenderRule(input: { pattern: string; action: "block" | "allow"; note?: string }, actor: CrmActor): Promise<void> {
  const pattern = normalizeRulePattern(input.pattern);
  if (!pattern) throw new CrmActionError("Укажите адрес (ivan@site.ru) или домен (site.ru)");
  await db.crmSenderRule.upsert({
    where: { pattern },
    create: { pattern, action: input.action, note: input.note || null, createdById: actor.id },
    update: { action: input.action, note: input.note || null },
  });
  await audit(actor, "crm.rule.save", pattern, { action: input.action });
}

export async function deleteSenderRule(id: string, actor: CrmActor): Promise<void> {
  const rule = await db.crmSenderRule.findUnique({ where: { id } });
  if (!rule) return;
  await db.crmSenderRule.delete({ where: { id } });
  await audit(actor, "crm.rule.delete", rule.pattern, { action: rule.action });
}

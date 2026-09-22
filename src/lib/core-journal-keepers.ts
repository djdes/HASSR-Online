import { db } from "@/lib/db";
import { sendRawEmail, renderEmailLayout } from "@/lib/email";
import { getPrimarySlotId } from "@/lib/journal-responsible-schemas";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { upsertNotification, type NotificationItem } from "@/lib/notifications";
import { notifyEmployee } from "@/lib/telegram";

/**
 * Кому сообщать о гигиене и здоровье (2026-09-22): все с галкой
 * «Ответственный за ведение основных журналов» + ответственный за
 * гигиенический журнал («Кто проводит осмотр» / ответственный документа).
 * Если никого нет — руководство организации.
 */
export type CoreJournalRecipient = { id: string; name: string; email: string | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Почта, на которую реально можно написать (синтетические «…@….local» — нет). */
export function deliverableEmail(user: { email: string | null; contactEmail?: string | null }): string | null {
  for (const raw of [user.contactEmail, user.email]) {
    const value = (raw ?? "").trim();
    if (value && EMAIL_RE.test(value) && !/\.(local|haccp)$/i.test(value) && !value.includes(".local.")) return value;
  }
  return null;
}

export async function listCoreJournalRecipients(organizationId: string, hygieneDocumentId?: string | null): Promise<CoreJournalRecipient[]> {
  const ids = new Set<string>();
  const keepers = await db.user.findMany({
    where: { organizationId, ...ORG_ROSTER_WHERE, keepsCoreJournals: true },
    select: { id: true },
  });
  for (const keeper of keepers) ids.add(keeper.id);

  let responsibleId: string | null = null;
  if (hygieneDocumentId) {
    const doc = await db.journalDocument.findFirst({ where: { id: hygieneDocumentId, organizationId }, select: { responsibleUserId: true } });
    responsibleId = doc?.responsibleUserId ?? null;
  }
  if (!responsibleId) {
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { journalResponsibleUsersJson: true } });
    const slots = ((org?.journalResponsibleUsersJson ?? {}) as Record<string, Record<string, string | null> | undefined>).hygiene ?? {};
    responsibleId = slots[getPrimarySlotId("hygiene")] ?? null;
  }
  if (responsibleId) ids.add(responsibleId);

  const where =
    ids.size > 0
      ? { organizationId, isActive: true, archivedAt: null, id: { in: [...ids] } }
      : { organizationId, isActive: true, archivedAt: null, isRoot: false, role: { in: ["manager", "head_chef", "owner", "technologist"] } };
  const users = await db.user.findMany({ where, select: { id: true, name: true, email: true, contactEmail: true } });
  return users.map((user) => ({ id: user.id, name: user.name, email: deliverableEmail(user) }));
}

/** Колокольчик + Telegram + письмо каждому получателю; ошибки канала не мешают остальным. */
export async function notifyCoreJournalRecipients(params: {
  organizationId: string;
  recipients: CoreJournalRecipient[];
  kind: string;
  dedupeKey: string;
  title: string;
  items: NotificationItem[];
  linkHref: string;
  linkLabel: string;
  telegramText: string;
  emailSubject: string;
  emailBodyHtml: string;
}): Promise<void> {
  await Promise.allSettled(
    params.recipients.flatMap((recipient) => [
      upsertNotification({
        organizationId: params.organizationId,
        userId: recipient.id,
        kind: params.kind,
        dedupeKey: params.dedupeKey,
        title: params.title,
        linkHref: params.linkHref,
        linkLabel: params.linkLabel,
        items: params.items,
      }),
      notifyEmployee(recipient.id, params.telegramText),
      recipient.email
        ? sendRawEmail(recipient.email, params.emailSubject, renderEmailLayout(params.title, params.emailBodyHtml))
        : Promise.resolve(false),
    ])
  );
}

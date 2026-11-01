import { db } from "@/lib/db";
import { sendRawEmail, renderEmailLayout } from "@/lib/email";
import { getPrimarySlotId } from "@/lib/journal-responsible-schemas";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { effectiveJournalSlots } from "@/lib/journal-responsibles-points";
import { upsertNotification, type NotificationItem } from "@/lib/notifications";
import { filterRecipientsByPlace } from "@/lib/place-recipients";
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
  let responsibleId: string | null = null;
  let documentPointId: string | null = null;
  if (hygieneDocumentId) {
    const doc = await db.journalDocument.findFirst({ where: { id: hygieneDocumentId, organizationId }, select: { responsibleUserId: true, buildingId: true } });
    responsibleId = doc?.responsibleUserId ?? null;
    documentPointId = doc?.buildingId ?? null;
  }

  // Ведущие основных журналов — только те, кому событие по месту
  // (2026-11-01): заведующая точки Б не получает «не отметились» точки А.
  const ids = new Set<string>();
  const keepers = await db.user.findMany({
    where: { organizationId, ...ORG_ROSTER_WHERE, keepsCoreJournals: true },
    select: { id: true, buildingIds: true },
  });
  for (const keeper of await filterRecipientsByPlace(organizationId, keepers, documentPointId)) ids.add(keeper.id);
  if (!responsibleId) {
    // Ответственный гигиены точки документа (2026-10-31, ответственные по точкам).
    const slots = await effectiveJournalSlots(organizationId, documentPointId, "hygiene");
    responsibleId = slots[getPrimarySlotId("hygiene")] ?? null;
  }
  if (responsibleId) ids.add(responsibleId);

  const select = { id: true, name: true, email: true, contactEmail: true, buildingIds: true } as const;
  const users =
    ids.size > 0
      ? await db.user.findMany({ where: { organizationId, isActive: true, archivedAt: null, id: { in: [...ids] } }, select })
      : // Никого нет — руководство точки документа и офис.
        await filterRecipientsByPlace(
          organizationId,
          await db.user.findMany({
            where: { organizationId, isActive: true, archivedAt: null, isRoot: false, role: { in: ["manager", "head_chef", "owner", "technologist"] } },
            select,
          }),
          documentPointId,
        );
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
      // Push уходит из колокольчика (upsertNotification выше) — второй не нужен.
      notifyEmployee(recipient.id, params.telegramText, undefined, { appPush: false }),
      recipient.email
        ? sendRawEmail(recipient.email, params.emailSubject, renderEmailLayout(params.title, params.emailBodyHtml))
        : Promise.resolve(false),
    ])
  );
}

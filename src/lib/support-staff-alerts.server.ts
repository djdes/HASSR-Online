import { normalizeEmail, phoneKey } from "@/lib/crm/identity";
import { db } from "@/lib/db";
import { publishToUsers } from "@/lib/live-events";
import { upsertNotification } from "@/lib/notifications";
import { platformOrgId } from "@/lib/partners/partner-hint";
import { PLATFORM_SECTION_KEYS } from "@/lib/platform-access";
import { inPlatformAudience } from "@/lib/platform-admin";
import {
  SUPPORT_ALERT_EVENT_KIND,
  supportAlertHref,
  supportAlertPreview,
  supportAlertWho,
  type SupportStaffAlert,
} from "@/lib/support-staff-alerts";
import type { SupportAttachmentMeta } from "@/lib/support-attachments-shared";

/**
 * Обращение или сообщение чата — всей команде поддержки: колокольчик (одно
 * уведомление на обращение, одно на ветку чата — новые сообщения
 * добавляются строками) и всплывашка на сайте по живому событию. Сбой не
 * мешает самому обращению: вызывающий ловит ошибку.
 */

type StaffRow = { id: string; organizationId: string; isRoot: boolean; platformSections: string[] };

let staffCache: { at: number; rows: StaffRow[] } | null = null;
const STAFF_CACHE_MS = 60_000;

/** ROOT, администраторы платформы и все с разделом «Обратная связь». */
export async function listSupportStaff(): Promise<StaffRow[]> {
  if (staffCache && Date.now() - staffCache.at < STAFF_CACHE_MS) return staffCache.rows;
  const rows = await db.user.findMany({
    where: {
      isActive: true,
      archivedAt: null,
      OR: [
        { isRoot: true },
        { platformSections: { has: "support" } },
        { platformSections: { hasEvery: [...PLATFORM_SECTION_KEYS] } },
      ],
    },
    select: { id: true, organizationId: true, isRoot: true, platformSections: true },
  });
  const staff = rows.filter((row) => inPlatformAudience(row, "support"));
  staffCache = { at: Date.now(), rows: staff };
  return staff;
}

/** Карточка клиента: организация, а у гостя — контакт CRM по почте или телефону. */
export async function resolveSupportClientHref(input: {
  organizationId?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<string | null> {
  if (input.organizationId && input.organizationId !== platformOrgId()) {
    return `/root/organizations/${encodeURIComponent(input.organizationId)}`;
  }
  const email = normalizeEmail(input.email);
  const phone = phoneKey(input.phone);
  if (!email && !phone) return null;
  const user = email
    ? await db.user.findFirst({
        where: {
          isRoot: false,
          archivedAt: null,
          organization: { isDemo: false, id: { not: platformOrgId() } },
          OR: [{ email: { equals: email, mode: "insensitive" } }, { contactEmail: { equals: email, mode: "insensitive" } }],
        },
        orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
        select: { organizationId: true },
      })
    : null;
  if (user) return `/root/organizations/${encodeURIComponent(user.organizationId)}`;
  const contact = await db.crmContact.findFirst({
    where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phoneKey: phone }] : [])] },
    orderBy: { lastActivityAt: "desc" },
    select: { id: true },
  });
  return contact ? `/root/crm/contacts/${encodeURIComponent(contact.id)}` : null;
}

async function alertSupportStaff(alert: SupportStaffAlert, item: { id: string; label: string; hint: string }): Promise<void> {
  const staff = await listSupportStaff();
  if (staff.length === 0) return;
  const reportTitle = "Новое обращение в поддержку";
  const chatTitle = "Новое сообщение в онлайн-чате";
  await Promise.all(
    staff.map((user) =>
      upsertNotification({
        organizationId: user.organizationId,
        userId: user.id,
        kind: alert.kind === "report" ? "platform.support.report" : "platform.support.chat",
        dedupeKey: `platform.support.${alert.kind}:${alert.id}`,
        title: alert.kind === "report" ? reportTitle : chatTitle,
        messageKey: alert.kind === "report" ? "supportReport" : "supportChat",
        linkHref: alert.href,
        linkLabel: "Открыть",
        linkLabelKey: "open",
        items: [{ id: item.id, label: item.label, ...(item.hint ? { hint: item.hint } : {}), href: alert.href }],
        // Push в приложение остаётся: прежнее уведомление о чате его слало.
      }).catch((error) => console.error("[support-alerts] notification failed", error)),
    ),
  );
  publishToUsers(
    staff.map((user) => user.id),
    { type: "support", kind: SUPPORT_ALERT_EVENT_KIND, data: alert },
  );
}

/** Новое обращение (форма сайта, кабинет, бот). */
export async function alertSupportStaffAboutReport(report: {
  id: string;
  type: string;
  message: string;
  userName?: string | null;
  userEmail?: string | null;
  phone?: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
  attachments?: SupportAttachmentMeta[] | null;
}): Promise<void> {
  const alert: SupportStaffAlert = {
    kind: "report",
    id: report.id,
    who: supportAlertWho({
      name: report.userName,
      email: report.userEmail,
      phone: report.phone,
      organizationName: report.organizationName,
    }),
    preview: supportAlertPreview(report.message, report.attachments ?? []),
    reportType: report.type,
    href: supportAlertHref("report", report.id),
    clientHref: await resolveSupportClientHref({
      organizationId: report.organizationId,
      email: report.userEmail,
      phone: report.phone,
    }).catch(() => null),
  };
  // В колокольчике — только «от кого»: текст обращения открывается по
  // нажатию, а не растягивает панель на полэкрана.
  await alertSupportStaff(alert, { id: report.id, label: alert.who || "—", hint: "" });
}

/** Новое сообщение клиента в онлайн-чате. */
export async function alertSupportStaffAboutChat(input: {
  thread: {
    id: string;
    organizationId: string | null;
    organizationName: string | null;
    userName: string | null;
    userEmail: string | null;
    phone: string | null;
  };
  message: { id: string; body: string; authorName?: string | null; attachments: SupportAttachmentMeta[] };
}): Promise<void> {
  const { thread, message } = input;
  const alert: SupportStaffAlert = {
    kind: "chat",
    id: thread.id,
    who: supportAlertWho({
      name: message.authorName ?? thread.userName,
      email: thread.userEmail,
      phone: thread.phone,
      organizationName: thread.organizationName,
    }),
    preview: supportAlertPreview(message.body, message.attachments),
    reportType: null,
    href: supportAlertHref("chat", thread.id),
    clientHref: await resolveSupportClientHref({
      organizationId: thread.organizationId,
      email: thread.userEmail,
      phone: thread.phone,
    }).catch(() => null),
  };
  await alertSupportStaff(alert, { id: message.id, label: alert.who || "—", hint: "" });
}

/**
 * Карточки клиентов для панели обращений одним заходом: организация, иначе
 * организация по почте пользователя, иначе контакт CRM по почте или телефону.
 */
export async function resolveSupportClientHrefs(
  entries: ReadonlyArray<{ key: string; organizationId?: string | null; email?: string | null; phone?: string | null }>,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const platform = platformOrgId();
  const pending: Array<{ key: string; email: string | null; phone: string | null }> = [];
  for (const entry of entries) {
    if (entry.organizationId && entry.organizationId !== platform) {
      out.set(entry.key, `/root/organizations/${encodeURIComponent(entry.organizationId)}`);
    } else {
      out.set(entry.key, null);
      const email = normalizeEmail(entry.email);
      const phone = phoneKey(entry.phone);
      if (email || phone) pending.push({ key: entry.key, email, phone });
    }
  }
  if (pending.length === 0) return out;
  const emails = [...new Set(pending.map((item) => item.email).filter((value): value is string => Boolean(value)))];
  const phones = [...new Set(pending.map((item) => item.phone).filter((value): value is string => Boolean(value)))];
  const [users, contacts] = await Promise.all([
    emails.length > 0
      ? db.user.findMany({
          where: {
            isRoot: false,
            archivedAt: null,
            organization: { isDemo: false, id: { not: platform } },
            OR: [
              { email: { in: emails, mode: "insensitive" } },
              { contactEmail: { in: emails, mode: "insensitive" } },
            ],
          },
          orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
          select: { email: true, contactEmail: true, organizationId: true },
        })
      : Promise.resolve([]),
    db.crmContact.findMany({
      where: {
        OR: [
          ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
          ...(phones.length > 0 ? [{ phoneKey: { in: phones } }] : []),
        ],
      },
      orderBy: { lastActivityAt: "desc" },
      select: { id: true, email: true, phoneKey: true },
    }),
  ]);
  const orgByEmail = new Map<string, string>();
  for (const user of users) {
    for (const value of [user.email, user.contactEmail]) {
      const email = normalizeEmail(value);
      if (email && !orgByEmail.has(email)) orgByEmail.set(email, user.organizationId);
    }
  }
  for (const item of pending) {
    const organizationId = item.email ? orgByEmail.get(item.email) : undefined;
    if (organizationId) {
      out.set(item.key, `/root/organizations/${encodeURIComponent(organizationId)}`);
      continue;
    }
    const contact = contacts.find(
      (row) => (item.email && row.email === item.email) || (item.phone && row.phoneKey === item.phone),
    );
    if (contact) out.set(item.key, `/root/crm/contacts/${encodeURIComponent(contact.id)}`);
  }
  return out;
}

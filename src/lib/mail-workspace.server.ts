import { createHash } from "node:crypto";
import type { Session } from "next-auth";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { canAccessPlatformPath } from "@/lib/platform-access";
import { clientDocumentRecipients } from "@/lib/client-documents";
import { readLegalProfile } from "@/lib/org-legal-profile";
import { clientEmailPreview, clientEmailView, sendClientEmail } from "@/lib/client-email.server";
import type { MailRecipient, MailWorkspaceHistory, MailWorkspaceInput, MailWorkspaceResult } from "@/lib/mail-workspace";

export class MailWorkspaceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

async function scope(session: Session): Promise<Prisma.OrganizationWhereInput> {
  const viewer = await platformViewerForSession(session);
  if (!canAccessPlatformPath(viewer, "/root/correspondence")) throw new MailWorkspaceError("Нет доступа", 403);
  return { id: { not: process.env.PLATFORM_ORG_ID || "platform" }, ...(!viewer.superadmin && viewer.scope === "own" ? { accountManagerId: session.user.id } : {}) };
}

const contactSelect = {
  id: true, name: true, accountantEmail: true, legalProfileJson: true,
  account: { select: { ownerUserId: true } },
  users: { where: { isActive: true, archivedAt: null, isRoot: false }, orderBy: { createdAt: "asc" as const }, select: { id: true, name: true, email: true, contactEmail: true } },
} satisfies Prisma.OrganizationSelect;
type ContactOrg = Prisma.OrganizationGetPayload<{ select: typeof contactSelect }>;

function recipientsOf(org: ContactOrg): MailRecipient[] {
  const people = org.users.map(user => ({ ...user, email: user.contactEmail?.trim() || user.email, isActive: true, archived: false, isRoot: false }));
  const owner = people.find(user => user.id === org.account?.ownerUserId) ?? people[0] ?? null;
  return clientDocumentRecipients({ owner, people, company: { accountantEmail: org.accountantEmail, emails: readLegalProfile(org.legalProfileJson)?.emails ?? [] } })
    .map(item => ({ organizationId: org.id, organizationName: org.name, email: item.email, label: item.label }));
}

export async function mailRecipientDirectory(session: Session, search = "") {
  const allowed = await scope(session);
  const q = search.trim().slice(0, 100);
  const contains = { contains: q, mode: "insensitive" as const };
  const orgs = await db.organization.findMany({
    where: { AND: [allowed, ...(q ? [{ OR: [
      { name: contains }, { accountantEmail: contains },
      { users: { some: { isActive: true, archivedAt: null, isRoot: false, OR: [{ name: contains }, { email: contains }, { contactEmail: contains }] } } },
      { legalProfileJson: { path: ["emails"], array_contains: [q.toLowerCase()] } },
    ] }] : [])] },
    select: contactSelect, orderBy: [{ name: "asc" }, { id: "asc" }], take: 31,
  });
  const items = orgs.slice(0, 30).flatMap(org => recipientsOf(org).filter(item => !q || `${item.organizationName} ${item.label} ${item.email}`.toLocaleLowerCase().includes(q.toLocaleLowerCase())));
  return { items, limited: orgs.length > 30 };
}

export async function validateMailRecipients(session: Session, input: Pick<MailWorkspaceInput, "recipients">) {
  const allowed = await scope(session);
  const ids = [...new Set(input.recipients.map(item => item.organizationId))];
  const orgs = await db.organization.findMany({ where: { AND: [allowed, { id: { in: ids } }] }, select: contactSelect });
  const contacts = orgs.flatMap(recipientsOf);
  const selected = input.recipients.map(item => contacts.find(contact => contact.organizationId === item.organizationId && contact.email === item.email));
  if (selected.some(item => !item)) throw new MailWorkspaceError("Получатель недоступен или его адрес изменился. Выберите его заново.", 404);
  return selected as MailRecipient[];
}

/** Bind a retry to actor, content, mailbox and recipient; recipient order is irrelevant. */
export function mailRecipientRequestId(actorId: string, input: MailWorkspaceInput, recipient: MailRecipient) {
  const hex = createHash("sha256").update(JSON.stringify([input.requestId, actorId, input.mailboxUserId ?? actorId, input.subject, input.message, recipient.organizationId, recipient.email])).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export async function sendWorkspaceMail(session: Session, input: MailWorkspaceInput): Promise<MailWorkspaceResult> {
  const recipients = await validateMailRecipients(session, input);
  if (!await clientEmailPreview(session.user.id, input)) throw new MailWorkspaceError("Проверьте подключение выбранного ящика в разделе «Моя почта».", 409);
  const items: MailWorkspaceResult["items"] = [];
  for (const recipient of recipients) {
    // Recheck scope/contact immediately before each SMTP operation as well as preflight.
    await validateMailRecipients(session, { recipients: [recipient] });
    const result = await sendClientEmail(recipient.organizationId, session.user.id, {
      ...input, to: recipient.email, requestId: mailRecipientRequestId(session.user.id, input, recipient),
    });
    if (!result) return { items, interrupted: true };
    items.push({ ...result.item, organizationId: recipient.organizationId, organizationName: recipient.organizationName });
  }
  return { items, interrupted: false };
}

export async function workspaceMailHistory(session: Session, cursor?: string | null): Promise<MailWorkspaceHistory> {
  const organization = await scope(session);
  const where = { organization };
  if (cursor && !await db.clientEmail.findFirst({ where: { ...where, id: cursor }, select: { id: true } })) return { items: [], nextCursor: null };
  const rows = await db.clientEmail.findMany({
    where, include: { organization: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return {
    items: rows.slice(0, 20).map(row => ({ ...clientEmailView(row), organizationId: row.organizationId, organizationName: row.organization.name })),
    nextCursor: rows.length > 20 ? rows[19].id : null,
  };
}

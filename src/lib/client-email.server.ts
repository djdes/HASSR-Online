import { db } from "@/lib/db";
import { resolveEmailSender } from "@/lib/email-sender-access.server";
import { renderEmailLayout } from "@/lib/email";
import { readMailSender, sendStaffEmail } from "@/lib/platform-mail.server";
import { formatFromAddress } from "@/lib/platform-mail";
import { clientEmailContent, type ClientEmailInput, type ClientEmailView, type ClientEmailHistory } from "@/lib/client-email";

type EmailRow = NonNullable<Awaited<ReturnType<typeof db.clientEmail.findFirst>>>;

export function clientEmailView(row: EmailRow): ClientEmailView {
  return {
    id: row.id, to: row.to, subject: row.subject, message: row.message, html: row.html,
    senderName: row.senderName, fromEmail: row.fromEmail, status: row.status, error: row.error,
    createdAt: row.createdAt.toISOString(), sentAt: row.sentAt?.toISOString() ?? null,
  };
}

export async function clientEmailPreview(userId: string, input: Pick<ClientEmailInput, "subject" | "message" | "mailboxUserId">) {
  const mailboxUserId = await resolveEmailSender(userId, input.mailboxUserId);
  if (!mailboxUserId) return null;
  const sender = await readMailSender(mailboxUserId);
  if (!sender || !sender.enabled || !sender.verifiedAt) return null;
  const content = clientEmailContent(input, sender);
  return { sender, mailboxUserId, html: renderEmailLayout(content.title, content.body), text: content.text };
}

export async function clientEmailHistory(organizationId: string, cursor?: string | null): Promise<ClientEmailHistory> {
  if (cursor && !await db.clientEmail.findFirst({ where: { id: cursor, organizationId }, select: { id: true } })) {
    return { items: [], nextCursor: null };
  }
  const rows = await db.clientEmail.findMany({
    where: { organizationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return { items: rows.slice(0, 20).map(clientEmailView), nextCursor: rows.length > 20 ? rows[19].id : null };
}

/** The unique organization/request key is claimed before any SMTP call. */
export async function sendClientEmail(organizationId: string, userId: string, input: ClientEmailInput) {
  const key = { organizationId_requestId: { organizationId, requestId: input.requestId } };
  const existing = await db.clientEmail.findUnique({ where: key });
  if (existing) return { item: clientEmailView(existing), repeated: true };
  const preview = await clientEmailPreview(userId, input);
  if (!preview) return null;
  let row: EmailRow;
  try {
    row = await db.clientEmail.create({ data: {
      organizationId, requestId: input.requestId, senderUserId: userId,
      senderName: preview.sender.fromName, fromEmail: preview.sender.fromEmail,
      to: input.to, subject: input.subject, message: input.message, html: preview.html,
    } });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const winner = await db.clientEmail.findUnique({ where: key });
    if (!winner) throw error;
    return { item: clientEmailView(winner), repeated: true };
  }
  // An uncertain outcome stays in history; never retry SMTP automatically.
  let result;
  try {
    result = await sendStaffEmail({
      senderUserId: preview.mailboxUserId, to: input.to, subject: input.subject,
      html: preview.html, text: preview.text, personalOnly: true,
      expectedFrom: formatFromAddress(preview.sender.fromName, preview.sender.fromEmail),
    });
  } catch {
    result = { ok: false as const, error: "Не удалось подтвердить отправку. Проверьте папку «Отправленные» перед новой попыткой." };
  }
  const saved = await db.clientEmail.update({ where: { id: row.id, organizationId }, data: result.ok
    ? { status: "sent", sentAt: new Date(), messageId: result.messageId ?? null }
    : { status: "failed", error: result.error },
  });
  return { item: clientEmailView(saved), repeated: false };
}

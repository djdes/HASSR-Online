import { db } from "@/lib/db";
import { readMailSender } from "@/lib/platform-mail.server";
import { EMAIL_SENDER_GRANTS_KEY, permittedEmailSenderIds, type EmailSenderOption } from "./email-sender-access";

async function senderIds(actorId: string) {
  const setting = await db.platformSetting.findUnique({ where: { key: EMAIL_SENDER_GRANTS_KEY } });
  return permittedEmailSenderIds(actorId, setting?.value ?? null);
}

/** The actor comes from the session; a requested mailbox is never trusted alone. */
export async function resolveEmailSender(actorId: string, requested?: string): Promise<string | null> {
  if (!requested || requested === actorId) return actorId;
  if (!(await senderIds(actorId)).includes(requested)) return null;
  const user = await db.user.findFirst({ where: { id: requested, isActive: true, archivedAt: null }, select: { id: true } });
  return user?.id ?? null;
}

export async function listEmailSenders(actorId: string): Promise<EmailSenderOption[]> {
  const ids = await senderIds(actorId);
  const users = await db.user.findMany({ where: { id: { in: ids }, isActive: true, archivedAt: null }, select: { id: true, name: true, email: true, contactEmail: true } });
  const byId = new Map(users.map(user => [user.id, user]));
  return (await Promise.all(ids.map(async userId => {
    const user = byId.get(userId);
    if (!user) return null;
    const sender = await readMailSender(userId);
    return { userId, fromName: sender?.fromName || user.name || "", fromEmail: sender?.fromEmail || user.contactEmail || user.email, ready: Boolean(sender?.enabled && sender.verifiedAt) };
  }))).filter((sender): sender is EmailSenderOption => sender !== null);
}

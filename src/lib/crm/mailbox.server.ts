import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/integration-crypto";
import { ingestCrmItems, type IngestedItem } from "@/lib/crm/ingest.server";
import { describeImapError, openImapSession, syncMailFolder, type MailSession } from "@/lib/crm/imap.server";
import type { MailboxInput, MailboxView } from "@/lib/crm/mailbox";
import type { SenderRule } from "@/lib/crm/identity";

/** Ящики IMAP CRM: настройки (пароль шифруется) и сбор почты. */

type MailboxRow = Awaited<ReturnType<typeof db.crmMailbox.findMany>>[number];

export class MailboxError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function toView(row: MailboxRow): MailboxView {
  return {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    inboxFolder: row.inboxFolder,
    sentFolder: row.sentFolder,
    enabled: row.enabled,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastError: row.lastError,
  };
}

export async function listMailboxes(): Promise<MailboxView[]> {
  return (await db.crmMailbox.findMany({ orderBy: { createdAt: "asc" } })).map(toView);
}

export async function createMailbox(input: MailboxInput, actorId: string): Promise<MailboxView> {
  if (!input.password) throw new MailboxError("Укажите пароль (для Яндекса и Mail.ru — пароль приложения)");
  const row = await db.crmMailbox.create({
    data: {
      label: input.label,
      host: input.host,
      port: input.port,
      secure: input.secure,
      username: input.username,
      passwordEnc: encryptSecret(input.password),
      inboxFolder: input.inboxFolder,
      sentFolder: input.sentFolder?.trim() || null,
      enabled: input.enabled,
      createdById: actorId,
    },
  });
  return toView(row);
}

/** Сменили сервер или логин — это другой ящик: курсоры читаем заново. */
export async function updateMailbox(id: string, input: MailboxInput): Promise<MailboxView> {
  const existing = await db.crmMailbox.findUnique({ where: { id } });
  if (!existing) throw new MailboxError("Ящик не найден", 404);
  const moved = existing.host !== input.host || existing.username !== input.username;
  const sentFolder = input.sentFolder?.trim() || null;
  const row = await db.crmMailbox.update({
    where: { id },
    data: {
      label: input.label,
      host: input.host,
      port: input.port,
      secure: input.secure,
      username: input.username,
      ...(input.password ? { passwordEnc: encryptSecret(input.password) } : {}),
      inboxFolder: input.inboxFolder,
      sentFolder,
      enabled: input.enabled,
      lastError: null,
      ...(moved || existing.inboxFolder !== input.inboxFolder ? { inboxUidValidity: null, inboxLastUid: 0 } : {}),
      ...(moved || existing.sentFolder !== sentFolder ? { sentUidValidity: null, sentLastUid: 0 } : {}),
    },
  });
  return toView(row);
}

export async function deleteMailbox(id: string): Promise<void> {
  await db.crmMailbox.deleteMany({ where: { id } });
}

async function sessionFor(row: MailboxRow): Promise<MailSession> {
  return openImapSession({ host: row.host, port: row.port, secure: row.secure, username: row.username, password: decryptSecret(row.passwordEnc) });
}

export type MailboxTestResult = { ok: true; folders: string[]; suggestedSent: string | null } | { ok: false; error: string };

/** Подключиться, войти и показать папки — без чтения писем. */
export async function testMailbox(id: string): Promise<MailboxTestResult> {
  const row = await db.crmMailbox.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Ящик не найден" };
  let session: MailSession | null = null;
  try {
    session = await sessionFor(row);
    const folders = await session.listFolders();
    const inbox = folders.find((item) => item.path.toLowerCase() === row.inboxFolder.toLowerCase());
    if (!inbox) throw new Error(`Папки «${row.inboxFolder}» нет. Есть: ${folders.map((item) => item.path).join(", ")}`);
    const sent = folders.find((item) => item.specialUse === "\\Sent")?.path ?? null;
    await db.crmMailbox.update({ where: { id }, data: { lastError: null } });
    return { ok: true, folders: folders.map((item) => item.path), suggestedSent: sent };
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("Папки «") ? error.message : describeImapError(error);
    await db.crmMailbox.update({ where: { id }, data: { lastError: message } });
    return { ok: false, error: message };
  } finally {
    await session?.logout().catch(() => undefined);
  }
}

export type MailboxSyncResult = { mailboxId: string; label: string; inbox: number; sent: number; filtered: number; error?: string };

/**
 * Сбор почты всех включённых ящиков. Курсор папки сохраняется только после
 * записи писем в ленту: упади запись — письма прочитаются в следующий раз.
 */
export async function syncAllMailboxes(now: Date, rules: readonly SenderRule[]): Promise<{ results: MailboxSyncResult[]; ingested: IngestedItem[] }> {
  const rows = await db.crmMailbox.findMany({ where: { enabled: true }, orderBy: { createdAt: "asc" } });
  const results: MailboxSyncResult[] = [];
  const ingested: IngestedItem[] = [];
  for (const row of rows) {
    const result: MailboxSyncResult = { mailboxId: row.id, label: row.label, inbox: 0, sent: 0, filtered: 0 };
    let session: MailSession | null = null;
    try {
      session = await sessionFor(row);
      const inbox = await syncMailFolder(session, {
        mailboxId: row.id,
        folder: row.inboxFolder,
        kind: "inbox",
        state: { uidValidity: row.inboxUidValidity, lastUid: row.inboxLastUid },
        rules,
        now,
      });
      const inboxIngest = await ingestCrmItems(inbox.items);
      ingested.push(...inboxIngest.items);
      result.inbox = inboxIngest.items.filter((entry) => !entry.item.filteredReason).length;
      result.filtered = inboxIngest.items.filter((entry) => entry.item.filteredReason).length;
      await db.crmMailbox.update({ where: { id: row.id }, data: { inboxUidValidity: inbox.next.uidValidity, inboxLastUid: inbox.next.lastUid } });

      if (row.sentFolder) {
        const sent = await syncMailFolder(session, {
          mailboxId: row.id,
          folder: row.sentFolder,
          kind: "sent",
          state: { uidValidity: row.sentUidValidity, lastUid: row.sentLastUid },
          rules,
          now,
        });
        const sentIngest = await ingestCrmItems(sent.items);
        result.sent = sentIngest.created;
        await db.crmMailbox.update({ where: { id: row.id }, data: { sentUidValidity: sent.next.uidValidity, sentLastUid: sent.next.lastUid } });
      }
      await db.crmMailbox.update({ where: { id: row.id }, data: { lastSyncAt: now, lastError: null } });
    } catch (error) {
      result.error = describeImapError(error);
      console.error(`[crm] ящик ${row.label} не прочитан`, error);
      await db.crmMailbox.update({ where: { id: row.id }, data: { lastSyncAt: now, lastError: result.error } }).catch(() => undefined);
    } finally {
      await session?.logout().catch(() => undefined);
    }
    results.push(result);
  }
  return { results, ingested };
}

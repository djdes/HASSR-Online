/**
 * Почта → CRM на локальной БД без живого IMAP: те же `syncMailFolder` и
 * `ingestCrmItems`, что в бою, с подменённой сессией. Письмо клиента — в
 * переписку и уведомление РОП; автоответ и рассылка — в «Отсеяно»;
 * «Вернуть и всегда пропускать» — контакт + правило allow; повтор — без дублей.
 *
 *   npx tsx .agent/tasks/crm-rop-2026-11/e2e/mail-ingest-check.ts
 */
import "dotenv/config";

import { db } from "../../../../src/lib/db";
import { restoreFilteredMail } from "../../../../src/lib/crm/actions.server";
import { syncMailFolder, type MailSession } from "../../../../src/lib/crm/imap.server";
import { ingestCrmItems } from "../../../../src/lib/crm/ingest.server";
import { notifyNewMail } from "../../../../src/lib/crm/notify.server";
import { moscowDateKey } from "../../../../src/lib/crm/reminders";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) process.exit(1);

const now = new Date();
const mail = (lines: string[]) => Buffer.from(lines.join("\r\n"));
const messages: Record<number, Buffer> = {
  1: mail(["From: Павел <pavel@grill-house.ru>", "To: admin@wesetup.ru", "Message-ID: <grill-1@grill-house.ru>", `Date: ${now.toUTCString()}`, "Subject: Подключение 4 ресторанов", "Content-Type: text/plain; charset=utf-8", "", "Добрый день! Нужны электронные журналы на 4 ресторана, пришлите КП."]),
  2: mail(["From: office@supplier.ru", "To: admin@wesetup.ru", "Message-ID: <auto-7@supplier.ru>", "Auto-Submitted: auto-replied", "Subject: Автоответ: в отпуске", "", "Я в отпуске до 20.11"]),
  3: mail(["From: news@marketing-tool.io", "To: admin@wesetup.ru", "Message-ID: <news-3@marketing-tool.io>", "List-Unsubscribe: <mailto:u@marketing-tool.io>", "Subject: Скидка 50%", "", "Только сегодня"]),
};
const session: MailSession = {
  async openFolder() {
    return {
      uidValidity: "42",
      uidNext: 4,
      async listUids() {
        return [1, 2, 3];
      },
      async fetch(uids) {
        return uids.map((uid) => ({ uid, source: messages[uid] }));
      },
      close() {},
    };
  },
  async listFolders() {
    return [{ path: "INBOX", specialUse: null }];
  },
  async logout() {},
};

async function main() {
  const rules = await db.crmSenderRule.findMany({ select: { pattern: true, action: true } });
  const folder = await syncMailFolder(session, { mailboxId: "local", folder: "INBOX", kind: "inbox", state: { uidValidity: null, lastUid: 0 }, rules, now });
  const first = await ingestCrmItems(folder.items);
  const again = await ingestCrmItems(folder.items);
  console.log(`folder: fetched=${folder.fetched} next=${JSON.stringify(folder.next)}`);
  console.log(`ingest: created=${first.created} contactsCreated=${first.contactsCreated}; repeat created=${again.created} skipped=${again.skipped}`);
  for (const entry of first.items) console.log(`  ${entry.item.externalKey} → ${entry.item.filteredReason ?? "accepted"} contact=${entry.contactId ? "yes" : "no"} new=${entry.isNewContact}`);

  const morning = new Date(`${moscowDateKey(new Date(now.getTime() + 86_400_000))}T10:00:00+03:00`);
  console.log(`new-mail alerts (working hours): ${await notifyNewMail(first.items, morning)}; repeat: ${await notifyNewMail(first.items, morning)}`);

  const auto = await db.crmInteraction.findUnique({ where: { externalKey: "email:auto-7@supplier.ru" } });
  const actor = await db.user.findFirstOrThrow({ where: { isRoot: true }, select: { id: true, name: true, organizationId: true } });
  const contactId = await restoreFilteredMail(auto!.id, true, actor);
  const restored = await db.crmInteraction.findUnique({ where: { id: auto!.id }, select: { contactId: true, filteredReason: true } });
  const rule = await db.crmSenderRule.findUnique({ where: { pattern: "office@supplier.ru" } });
  console.log(`restore: contact=${restored?.contactId === contactId} filteredReason=${restored?.filteredReason} allowRule=${rule?.action}`);
  const pavel = await db.crmContact.findFirst({ where: { email: "pavel@grill-house.ru" }, select: { stage: true, source: true, awaitingSince: true, awaitingChannel: true } });
  console.log(`pavel: ${JSON.stringify(pavel)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(process.exitCode ?? 0);
  });

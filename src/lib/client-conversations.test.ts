import assert from "node:assert/strict";
import test from "node:test";

import { clientIdentityKeys } from "@/lib/client-conversations.server";
import type { ClientContacts } from "@/lib/root-client-card.server";

test("ключи клиента: почты в нижнем регистре, телефоны по 10 цифрам, без сотрудников платформы", () => {
  const contacts = {
    owner: null,
    requisites: null,
    company: { phones: ["8 (495) 109-65-43"], emails: ["Info@Kafe.ru"], accountantEmail: "buh@kafe.ru", website: null, address: null },
    people: [
      { isRoot: false, email: "Anna@Kafe.ru", loginEmail: null, phone: "+7 925 305-80-77" },
      { isRoot: true, email: "admin@wesetup.ru", loginEmail: null, phone: "+7 999 000-00-00" },
    ],
  } as unknown as ClientContacts;
  const keys = clientIdentityKeys(contacts);
  assert.deepEqual(keys.emails.sort(), ["anna@kafe.ru", "buh@kafe.ru", "info@kafe.ru"]);
  assert.deepEqual(keys.phoneKeys.sort(), ["4951096543", "9253058077"]);
  assert.deepEqual(clientIdentityKeys(null), { emails: [], phoneKeys: [] });
});

test("переписки: письма сайта и рассылки по почтам клиента, без дублей по Message-ID", async () => {
  const { db } = await import("@/lib/db");
  const { loadClientConversations } = await import("@/lib/client-conversations.server");
  const { clientEmailMessageId } = await import("@/lib/client-email");
  const original = {
    contacts: db.crmContact.findMany, interactions: db.crmInteraction.findMany, clientEmails: db.clientEmail.findMany,
    outgoing: db.outgoingEmail.findMany, mailings: db.mailingRecipient.findMany, users: db.user.findMany,
  };
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 24, 9, minute));
  const seen: Record<string, unknown> = {};
  db.crmContact.findMany = (async () => [{ id: "c1", name: "Анна", company: null, email: "anna@kafe.ru", phone: null }]) as unknown as typeof original.contacts;
  db.crmInteraction.findMany = (async () => [
    { id: "i1", contactId: "c1", channel: "email", direction: "out", subject: "Из CRM", body: "Ответ", authorName: "Олег", fromAddress: "oleg@wesetup.ru", href: null, occurredAt: at(1), externalKey: "email-out:crm-1@wesetup.ru:anna@kafe.ru", call: null },
  ]) as unknown as typeof original.interactions;
  db.clientEmail.findMany = (async (args: { where: unknown }) => {
    seen.clientEmail = args.where;
    return [{ id: "e1", to: "anna@kafe.ru", subject: "Из карточки", message: "Текст", senderName: "Олег", fromEmail: "oleg@wesetup.ru", status: "failed", error: "SMTP", messageId: null, attachmentsJson: [{ filename: "КП.pdf", size: 1, contentType: "application/pdf" }], createdAt: at(2), sentAt: null }];
  }) as unknown as typeof original.clientEmails;
  db.outgoingEmail.findMany = (async (args: { where: unknown }) => {
    seen.outgoing = args.where;
    return [
      { id: "o1", to: "anna@kafe.ru", via: "system", fromEmail: "noreply@wesetup.ru", senderUserId: null, subject: "Журналы не заполнены", text: "Заполните журнал", attachmentsJson: null, status: "sent", error: null, messageId: "<auto-1@wesetup.ru>", createdAt: at(3) },
      { id: "o2", to: "anna@kafe.ru", via: "system", fromEmail: "noreply@wesetup.ru", senderUserId: null, subject: "Код подтверждения", text: null, attachmentsJson: null, status: "sent", error: null, messageId: null, createdAt: at(4) },
      { id: "o3", to: "anna@kafe.ru", via: "personal", fromEmail: "oleg@wesetup.ru", senderUserId: "u1", subject: "Из карточки", text: "Текст", attachmentsJson: null, status: "failed", error: "SMTP", messageId: clientEmailMessageId("e1"), createdAt: at(2) },
      { id: "o4", to: "anna@kafe.ru", via: "personal", fromEmail: "oleg@wesetup.ru", senderUserId: "u1", subject: "Из CRM", text: "Ответ", attachmentsJson: null, status: "sent", error: null, messageId: "<crm-1@wesetup.ru>", createdAt: at(1) },
      { id: "o5", to: "anna@kafe.ru", via: "personal", fromEmail: "oleg@wesetup.ru", senderUserId: "u1", subject: "Договор", text: "Договор во вложении", attachmentsJson: [{ filename: "Договор.pdf", size: 1, contentType: "application/pdf" }], status: "sent", error: null, messageId: "<doc-1@wesetup.ru>", createdAt: at(5) },
    ];
  }) as unknown as typeof original.outgoing;
  db.mailingRecipient.findMany = (async () => [
    { id: "m1", email: "anna@kafe.ru", emailStatus: "sent", emailError: null, emailSentAt: at(6), createdAt: at(0), campaign: { id: "camp", title: "Ноябрь", payload: { subject: "Новое в WeSetup", body: "Что нового" } } },
  ]) as unknown as typeof original.mailings;
  db.user.findMany = (async () => [{ id: "u1", name: "Олег" }]) as unknown as typeof original.users;
  try {
    const contacts = { owner: null, requisites: null, company: { phones: [], emails: [], accountantEmail: null, website: null, address: null }, people: [{ isRoot: false, email: "Anna@Kafe.ru", loginEmail: null, phone: null }] } as unknown as ClientContacts;
    const data = await loadClientConversations("org-1", contacts);
    assert.deepEqual(data.items.map((item) => item.id), ["mailing:m1", "outgoing-email:o5", "outgoing-email:o2", "outgoing-email:o1", "client-email:e1", "i1"]);
    assert.deepEqual(seen.outgoing, { OR: [{ organizationId: "org-1" }, { to: { in: ["anna@kafe.ru"] } }] }, "журнал — по организации и по почтам людей");
    assert.deepEqual(seen.clientEmail, { OR: [{ organizationId: "org-1" }, { to: { in: ["anna@kafe.ru"] } }] });
    const auto = data.items.find((item) => item.id === "outgoing-email:o1");
    assert.equal(auto?.automatic, true);
    assert.equal(auto?.body, "Заполните журнал");
    const secret = data.items.find((item) => item.id === "outgoing-email:o2");
    assert.equal(secret?.hiddenBody, true);
    const doc = data.items.find((item) => item.id === "outgoing-email:o5");
    assert.equal(doc?.automatic, false);
    assert.equal(doc?.authorName, "Олег");
    assert.deepEqual(doc?.attachments, ["Договор.pdf"]);
    const card = data.items.find((item) => item.id === "client-email:e1");
    assert.match(String(card?.status), /^не отправлено: SMTP/);
    assert.deepEqual(card?.attachments, ["КП.pdf"]);
    const mailing = data.items.find((item) => item.id === "mailing:m1");
    assert.equal(mailing?.subject, "Новое в WeSetup");
    assert.equal(mailing?.href, "/root/mailing/camp");
  } finally {
    db.crmContact.findMany = original.contacts; db.crmInteraction.findMany = original.interactions; db.clientEmail.findMany = original.clientEmails;
    db.outgoingEmail.findMany = original.outgoing; db.mailingRecipient.findMany = original.mailings; db.user.findMany = original.users;
  }
});

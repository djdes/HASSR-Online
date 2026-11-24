import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import nodemailer from "nodemailer";

import { db } from "@/lib/db";

/**
 * Журнал исходящих писем на общей почте (спека client-mail-templates-2026-11-24):
 * автоматические письма сайта попадают в `OutgoingEmail` с организацией
 * получателя; письма с паролем и ссылкой входа — без текста; сбой SMTP —
 * строкой «failed»; перехват и отсутствие SMTP журнал не трогают.
 */
const original = { createMany: db.outgoingEmail.createMany, findFirst: db.user.findFirst };
const oldHost = process.env.SMTP_HOST;
let journal: Record<string, unknown>[];
let smtpError: Error | null;
let sent: Record<string, unknown>[];

beforeEach(() => {
  process.env.SMTP_HOST = "smtp.relay.test";
  journal = []; sent = []; smtpError = null;
  db.outgoingEmail.createMany = (async (args) => {
    const data = Array.isArray(args?.data) ? args.data : [args?.data];
    journal.push(...(data as Record<string, unknown>[]));
    return { count: data.length };
  }) as typeof original.createMany;
  db.user.findFirst = (async (args) => {
    const json = JSON.stringify(args?.where ?? {});
    return json.includes("owner@kafe.ru") ? { organizationId: "org-kafe" } : null;
  }) as typeof original.findFirst;
  mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (message: Record<string, unknown>) => {
      if (smtpError) throw smtpError;
      sent.push(message);
      return { messageId: message.messageId ?? "<auto@wesetup.ru>" };
    },
  }));
});

afterEach(() => {
  mock.restoreAll();
  db.outgoingEmail.createMany = original.createMany; db.user.findFirst = original.findFirst;
  if (oldHost === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = oldHost;
});

test("автоматическое письмо: в журнале с текстом, организацией получателя и Message-ID; ссылки без токенов", async () => {
  const { sendRawEmail } = await import("@/lib/email");
  const ok = await sendRawEmail("Owner@Kafe.ru", "Журналы не заполнены", "<p>Заполните журнал: <a href=\"https://wesetup.ru/r/abc.def123456789xyz/1\">открыть</a></p>", {
    text: "Заполните журнал: https://wesetup.ru/r/abc.def123456789xyz/1",
    messageId: "<crm-1@wesetup.ru>",
  });
  assert.equal(ok, true);
  assert.equal(sent[0].messageId, "<crm-1@wesetup.ru>", "свой Message-ID доходит до SMTP");
  assert.equal(journal.length, 1);
  assert.equal(journal[0].to, "owner@kafe.ru");
  assert.equal(journal[0].organizationId, "org-kafe");
  assert.equal(journal[0].via, "system");
  assert.equal(journal[0].status, "sent");
  assert.equal(journal[0].messageId, "<crm-1@wesetup.ru>");
  assert.equal(journal[0].text, "Заполните журнал: https://wesetup.ru/r/…");
});

test("письмо со ссылкой сброса пароля: адрес и тема в журнале, текста нет", async () => {
  const { sendPasswordResetEmail } = await import("@/lib/email");
  await sendPasswordResetEmail({ to: "stranger@mail.ru", resetUrl: "https://wesetup.ru/reset/SECRET-TOKEN-123456789" });
  assert.equal(journal.length, 1);
  assert.equal(journal[0].text, null);
  assert.equal(journal[0].organizationId, null);
  assert.doesNotMatch(JSON.stringify(journal[0]), /SECRET-TOKEN/);
});

test("сбой SMTP — строка failed с ошибкой; перехват образцов журнал не пишет", async () => {
  const { captureOutgoingEmails, sendRawEmail } = await import("@/lib/email");
  smtpError = new Error("Connection timeout");
  assert.equal(await sendRawEmail("owner@kafe.ru", "Счёт", "<p>Счёт</p>"), false);
  assert.equal(journal.length, 1);
  assert.equal(journal[0].status, "failed");
  assert.equal(journal[0].error, "Connection timeout");
  smtpError = null; journal = [];
  await captureOutgoingEmails(() => sendRawEmail("owner@kafe.ru", "Образец", "<p>x</p>"));
  assert.equal(journal.length, 0, "образцы для ROOT → «Письма» не отправляются и не журналируются");
});

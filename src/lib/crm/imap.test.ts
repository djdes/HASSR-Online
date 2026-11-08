import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseMail, syncMailFolder, type FetchedMail, type MailFolder, type MailSession } from "@/lib/crm/imap.server";

const now = new Date("2026-11-07T09:00:00Z");

function raw(lines: string[]): Buffer {
  return Buffer.from(lines.join("\r\n"), "utf8");
}

const clientMail = (id: string) =>
  raw([
    "From: =?UTF-8?B?0JjQstCw0L0=?= <Ivan@Cafe.ru>",
    "To: admin@wesetup.ru",
    `Message-ID: <${id}@cafe.ru>`,
    "Date: Fri, 07 Nov 2026 11:00:00 +0300",
    "Subject: =?UTF-8?B?0KHQutC+0LvRjNC60L4g0YHRgtC+0LjRgj8=?=",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Сколько стоит на 3 точки?",
    "",
    "On Thu, 6 Nov 2026 at 10:00, WeSetup <admin@wesetup.ru> wrote:",
    "> старое письмо",
  ]);

const autoReply = raw([
  "From: robot@shop.ru",
  "To: admin@wesetup.ru",
  "Message-ID: <auto-1@shop.ru>",
  "Auto-Submitted: auto-replied",
  "Subject: Re: hello",
  "",
  "I am away",
]);

const sentMail = raw([
  "From: Alexey <alexey@wesetup.ru>",
  "To: ivan@cafe.ru, colleague@wesetup.ru",
  "Cc: ivan@cafe.ru, boss@cafe.ru",
  "Message-ID: <out-1@wesetup.ru>",
  "Date: Fri, 07 Nov 2026 11:30:00 +0300",
  "Subject: Re: Сколько стоит?",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Иван, добрый день! Отправляю КП.",
]);

function fakeSession(folders: Record<string, { uidValidity: string; uidNext: number; messages: Record<number, Buffer>; sinceUids?: number[] }>) {
  const calls: { folder: string; afterUid: number; since: Date | null }[] = [];
  const session: MailSession = {
    async openFolder(path) {
      const folder = folders[path];
      if (!folder) throw new Error(`no folder ${path}`);
      const view: MailFolder = {
        uidValidity: folder.uidValidity,
        uidNext: folder.uidNext,
        async listUids(afterUid, since) {
          calls.push({ folder: path, afterUid, since });
          const all = Object.keys(folder.messages).map(Number);
          if (since) return folder.sinceUids ?? all;
          // IMAP «N:*» возвращает последнее письмо, даже если его UID меньше N.
          const tail = all.filter((uid) => uid > afterUid);
          return tail.length ? tail : all.slice(-1);
        },
        async fetch(uids) {
          return uids.map((uid): FetchedMail => ({ uid, source: folder.messages[uid] }));
        },
        close() {},
      };
      return view;
    },
    async listFolders() {
      return Object.keys(folders).map((path) => ({ path, specialUse: null }));
    },
    async logout() {},
  };
  return { session, calls };
}

describe("CRM: почта IMAP", () => {
  it("разбор письма: адрес, имя, тема в base64, Message-ID без скобок", async () => {
    const mail = await parseMail(clientMail("m1"));
    assert.equal(mail.fromAddress, "ivan@cafe.ru");
    assert.equal(mail.fromName, "Иван");
    assert.equal(mail.subject, "Сколько стоит?");
    assert.equal(mail.messageId, "m1@cafe.ru");
    assert.equal(mail.date?.toISOString(), "2026-11-07T08:00:00.000Z");
  });

  it("первый проход — окно 30 дней; письмо клиента принято без цитаты, автоответ отсеян", async () => {
    const { session, calls } = fakeSession({ INBOX: { uidValidity: "777", uidNext: 13, messages: { 10: clientMail("m1"), 12: autoReply } } });
    const result = await syncMailFolder(session, { mailboxId: "mb1", folder: "INBOX", kind: "inbox", state: { uidValidity: null, lastUid: 0 }, rules: [], now });
    assert.equal(calls[0].afterUid, 0);
    assert.equal(calls[0].since?.toISOString(), "2026-10-08T09:00:00.000Z");
    assert.deepEqual(result.next, { uidValidity: "777", lastUid: 12 });
    assert.equal(result.items.length, 2);
    const [client, auto] = result.items;
    assert.equal(client.externalKey, "email:m1@cafe.ru");
    assert.equal(client.direction, "in");
    assert.equal(client.body, "Сколько стоит на 3 точки?");
    assert.deepEqual(client.identity, { email: "ivan@cafe.ru", name: "Иван" });
    assert.equal(client.filteredReason, null);
    assert.equal(auto.filteredReason, "auto_reply");
    assert.deepEqual(auto.identity, {}, "отсеянное — без контакта");
    assert.equal(auto.fromAddress, "robot@shop.ru");
  });

  it("дальше — только новые UID; «N:*» с последним старым письмом не дублирует", async () => {
    const { session, calls } = fakeSession({ INBOX: { uidValidity: "777", uidNext: 13, messages: { 10: clientMail("m1"), 12: autoReply } } });
    const result = await syncMailFolder(session, { mailboxId: "mb1", folder: "INBOX", kind: "inbox", state: { uidValidity: "777", lastUid: 12 }, rules: [], now });
    assert.deepEqual(calls[0], { folder: "INBOX", afterUid: 12, since: null });
    assert.equal(result.items.length, 0);
    assert.deepEqual(result.next, { uidValidity: "777", lastUid: 12 });
  });

  it("смена UIDVALIDITY — проход заново по окну; пустое окно запоминает UIDNEXT", async () => {
    const { session, calls } = fakeSession({ INBOX: { uidValidity: "900", uidNext: 51, messages: { 50: clientMail("m2") }, sinceUids: [] } });
    const result = await syncMailFolder(session, { mailboxId: "mb1", folder: "INBOX", kind: "inbox", state: { uidValidity: "777", lastUid: 12 }, rules: [], now });
    assert.ok(calls[0].since, "окно по дате");
    assert.equal(result.items.length, 0);
    assert.deepEqual(result.next, { uidValidity: "900", lastUid: 50 }, "следующий проход не читает всю историю");
  });

  it("рассылка распознаётся по List-Unsubscribe из сырых заголовков (mailparser сворачивает их в `list`)", async () => {
    const newsletter = raw([
      "From: Команда сервиса <team@service-news.ru>",
      "To: admin@wesetup.ru",
      "Message-ID: <promo-1@service-news.ru>",
      "List-Unsubscribe: <mailto:unsubscribe@service-news.ru>,",
      " <https://service-news.ru/u>",
      "Subject: Скидки недели",
      "",
      "Только сегодня",
    ]);
    const mail = await parseMail(newsletter);
    assert.match(mail.headers["list-unsubscribe"], /^<mailto:unsubscribe@service-news\.ru>, <https:\/\/service-news\.ru\/u>$/);
    const { session } = fakeSession({ INBOX: { uidValidity: "1", uidNext: 2, messages: { 1: newsletter } } });
    const result = await syncMailFolder(session, { mailboxId: "mb1", folder: "INBOX", kind: "inbox", state: { uidValidity: null, lastUid: 0 }, rules: [], now });
    assert.equal(result.items[0].filteredReason, "newsletter");
  });

  it("правило allow пропускает даже автоответ", async () => {
    const { session } = fakeSession({ INBOX: { uidValidity: "1", uidNext: 2, messages: { 1: autoReply } } });
    const result = await syncMailFolder(session, { mailboxId: "mb1", folder: "INBOX", kind: "inbox", state: { uidValidity: null, lastUid: 0 }, rules: [{ pattern: "@shop.ru", action: "allow" }], now });
    assert.equal(result.items[0].filteredReason, null);
  });

  it("«Отправленные»: исходящее каждому внешнему адресату один раз, только к известным контактам", async () => {
    const { session } = fakeSession({ Sent: { uidValidity: "5", uidNext: 4, messages: { 3: sentMail } } });
    const result = await syncMailFolder(session, { mailboxId: "mb1", folder: "Sent", kind: "sent", state: { uidValidity: "5", lastUid: 2 }, rules: [], now });
    assert.deepEqual(
      result.items.map((item) => [item.externalKey, item.direction, item.createContact]),
      [
        ["email-out:out-1@wesetup.ru:ivan@cafe.ru", "out", false],
        ["email-out:out-1@wesetup.ru:boss@cafe.ru", "out", false],
      ],
    );
    assert.equal(result.items[0].authorName, "Alexey");
    assert.deepEqual(result.next, { uidValidity: "5", lastUid: 3 });
  });

  it("битое письмо не останавливает папку", async () => {
    const { session } = fakeSession({ INBOX: { uidValidity: "1", uidNext: 3, messages: { 1: Buffer.alloc(0), 2: clientMail("m3") } } });
    const result = await syncMailFolder(session, { mailboxId: "mb1", folder: "INBOX", kind: "inbox", state: { uidValidity: null, lastUid: 0 }, rules: [], now });
    assert.equal(result.next.lastUid, 2);
    assert.ok(result.items.some((item) => item.externalKey === "email:m3@cafe.ru"));
  });
});

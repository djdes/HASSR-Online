import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OUR_MAIL_DOMAINS } from "@/lib/crm/constants";
import { classifyIncomingMail, type IncomingMail } from "@/lib/crm/mail-filter";

const options = { rules: [] as { pattern: string; action: string }[], ourDomains: OUR_MAIL_DOMAINS };

function mail(overrides: Partial<IncomingMail> = {}): IncomingMail {
  return { fromAddress: "ivan@cafe-rostov.ru", subject: "Сколько стоит подключение?", headers: {}, contentType: "text/plain", ...overrides };
}

describe("CRM: отсев входящей почты", () => {
  it("обычное письмо человека принимается", () => {
    assert.deepEqual(classifyIncomingMail(mail(), options), { accept: true });
    assert.deepEqual(classifyIncomingMail(mail({ fromAddress: "chef@yandex.ru", subject: "Re: КП WeSetup" }), options), { accept: true });
  });

  it("нет отправителя и наш домен", () => {
    assert.deepEqual(classifyIncomingMail(mail({ fromAddress: null }), options), { accept: false, reason: "no_sender" });
    assert.deepEqual(classifyIncomingMail(mail({ fromAddress: "noreply@wesetup.ru" }), options), { accept: false, reason: "internal" });
    assert.deepEqual(classifyIncomingMail(mail({ fromAddress: "alexey@mail.wesetup.ru" }), options), { accept: false, reason: "internal" });
  });

  it("недоставка: mailer-daemon, multipart/report, тема", () => {
    assert.equal(classifyIncomingMail(mail({ fromAddress: "MAILER-DAEMON@mx.yandex.ru" }), options).accept, false);
    assert.deepEqual(classifyIncomingMail(mail({ contentType: "multipart/report; report-type=delivery-status" }), options), { accept: false, reason: "bounce" });
    assert.deepEqual(classifyIncomingMail(mail({ subject: "Undelivered Mail Returned to Sender" }), options), { accept: false, reason: "bounce" });
    assert.deepEqual(classifyIncomingMail(mail({ subject: "Письмо не доставлено" }), options), { accept: false, reason: "bounce" });
  });

  it("автоответы по RFC 3834 и нестандартным заголовкам", () => {
    const auto = (headers: Record<string, string>, subject = "Здравствуйте") => classifyIncomingMail(mail({ headers, subject }), options);
    assert.deepEqual(auto({ "auto-submitted": "auto-replied" }), { accept: false, reason: "auto_reply" });
    assert.deepEqual(auto({ "auto-submitted": "no" }), { accept: true });
    assert.deepEqual(auto({ "x-autoreply": "yes" }), { accept: false, reason: "auto_reply" });
    assert.deepEqual(auto({ "x-autorespond": "1" }), { accept: false, reason: "auto_reply" });
    assert.deepEqual(auto({ "x-auto-response-suppress": "All" }), { accept: false, reason: "auto_reply" });
    assert.deepEqual(auto({ precedence: "auto_reply" }), { accept: false, reason: "auto_reply" });
    assert.deepEqual(auto({}, "Автоответ: в отпуске до 15.11"), { accept: false, reason: "auto_reply" });
    assert.deepEqual(auto({}, "Re: Out of Office"), { accept: false, reason: "auto_reply" });
  });

  it("спам-метки сервера", () => {
    assert.deepEqual(classifyIncomingMail(mail({ headers: { "x-spam-flag": "YES" } }), options), { accept: false, reason: "spam" });
    assert.deepEqual(classifyIncomingMail(mail({ headers: { "x-spam-status": "Yes, score=9.1" } }), options), { accept: false, reason: "spam" });
    assert.deepEqual(classifyIncomingMail(mail({ headers: { "x-yandex-spam": "4" } }), options), { accept: false, reason: "spam" });
    assert.deepEqual(classifyIncomingMail(mail({ headers: { "x-yandex-spam": "1" } }), options), { accept: true });
  });

  it("рассылки и роботы", () => {
    assert.deepEqual(classifyIncomingMail(mail({ headers: { "list-unsubscribe": "<mailto:u@x.ru>" } }), options), { accept: false, reason: "newsletter" });
    assert.deepEqual(classifyIncomingMail(mail({ headers: { "list-id": "<news.x.ru>" } }), options), { accept: false, reason: "newsletter" });
    assert.deepEqual(classifyIncomingMail(mail({ headers: { precedence: "bulk" } }), options), { accept: false, reason: "newsletter" });
    for (const address of ["noreply@sber.ru", "no-reply@github.com", "do-not-reply@x.com", "notifications@vk.com", "robot@kontur.ru"]) {
      assert.deepEqual(classifyIncomingMail(mail({ fromAddress: address }), options), { accept: false, reason: "robot" }, address);
    }
    // «info@» — живой ящик компании, не робот.
    assert.deepEqual(classifyIncomingMail(mail({ fromAddress: "info@cafe.ru" }), options), { accept: true });
  });

  it("правила: allow бьёт любую эвристику, block — всё остальное", () => {
    const rules = [
      { pattern: "news@partner.ru", action: "allow" },
      { pattern: "@spam-shop.ru", action: "block" },
    ];
    assert.deepEqual(classifyIncomingMail(mail({ fromAddress: "news@partner.ru", headers: { "list-id": "x" } }), { rules, ourDomains: OUR_MAIL_DOMAINS }), { accept: true });
    assert.deepEqual(classifyIncomingMail(mail({ fromAddress: "sale@spam-shop.ru" }), { rules, ourDomains: OUR_MAIL_DOMAINS }), { accept: false, reason: "blocked" });
    // block домена бьёт даже письмо, которое иначе было бы принято.
    assert.deepEqual(classifyIncomingMail(mail({ fromAddress: "ceo@mail.spam-shop.ru" }), { rules, ourDomains: OUR_MAIL_DOMAINS }), { accept: false, reason: "blocked" });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { htmlToText, previewLine, stripQuotedReply, truncateBody } from "@/lib/crm/mail-text";

describe("CRM: текст письма для ленты", () => {
  it("срезает цитату Gmail/Яндекса и строки с >", () => {
    const gmail = "Да, давайте в четверг.\n\nOn Mon, 3 Nov 2026 at 10:00, Alexey <alexey@wesetup.ru> wrote:\n> Когда удобно?";
    assert.equal(stripQuotedReply(gmail), "Да, давайте в четверг.");
    const yandex = "Спасибо!\n\n03.11.2026, 10:00, \"Алексей\" <alexey@wesetup.ru>:\nпишет:\nстарый текст";
    assert.equal(stripQuotedReply("Спасибо!\n\n03.11.2026, 10:00, Алексей пишет:\nстарый текст"), "Спасибо!");
    assert.ok(stripQuotedReply(yandex).startsWith("Спасибо!"));
    assert.equal(stripQuotedReply("Ок\n> цитата\n> ещё"), "Ок");
  });

  it("срезает Outlook-блок и подпись «-- »", () => {
    const outlook = "Пришлите счёт.\n\nFrom: Alexey\nSent: Monday\nSubject: КП";
    assert.equal(stripQuotedReply(outlook), "Пришлите счёт.");
    assert.equal(stripQuotedReply("Текст\n-- \nИван, +7 900"), "Текст");
    assert.equal(stripQuotedReply("Текст\n\n-----Original Message-----\nстарое"), "Текст");
  });

  it("письмо из одной цитаты показывается целиком", () => {
    assert.equal(stripQuotedReply("> только цитата"), "> только цитата");
  });

  it("обрезка и превью", () => {
    assert.equal(truncateBody("abc", 10), "abc");
    assert.equal(truncateBody("a".repeat(20), 10).length, 10);
    assert.ok(truncateBody("a".repeat(20), 10).endsWith("…"));
    assert.equal(previewLine("  много\n\nстрок  "), "много строк");
  });

  it("HTML → текст", () => {
    assert.equal(htmlToText("<p>Привет</p><p>Как&nbsp;дела &amp; цены?</p><style>p{}</style>"), "Привет\nКак дела & цены?");
    assert.equal(htmlToText("a<br>b"), "a\nb");
  });
});

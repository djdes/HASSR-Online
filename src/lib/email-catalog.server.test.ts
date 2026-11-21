import assert from "node:assert/strict";
import test from "node:test";

import { captureOutgoingEmails } from "@/lib/email";
import {
  EMAIL_CATALOG,
  EMAIL_CATALOG_GROUPS,
  findCatalogEntry,
  renderCatalogEmail,
  sendCatalogSample,
} from "@/lib/email-catalog.server";

/**
 * Каталог ROOT → «Письма» (спека emails-preheader-text-root-catalog-2026-11-21):
 * каждое письмо сайта клиентам собирается настоящими функциями на примерах,
 * ничего не отправляя.
 */

test("каталог: id уникальны, группы известные, у каждого письма есть языки", () => {
  const ids = EMAIL_CATALOG.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "id повторяются");
  assert.ok(ids.length >= 30, `писем в каталоге: ${ids.length}`);
  for (const entry of EMAIL_CATALOG) {
    assert.ok((EMAIL_CATALOG_GROUPS as readonly string[]).includes(entry.group), `${entry.id}: группа ${entry.group}`);
    assert.ok(entry.locales.length > 0 && entry.locales[0] === "ru", `${entry.id}: первый язык — ru`);
    assert.match(entry.id, /^[a-z][a-z0-9-]*$/, `${entry.id}: id для адреса и словаря`);
  }
  for (const group of EMAIL_CATALOG_GROUPS) {
    assert.ok(EMAIL_CATALOG.some((entry) => entry.group === group), `пустая группа ${group}`);
  }
});

test("каталог: каждое письмо собирается на всех своих языках — тема, общий шаблон, текст, строка во входящих", async () => {
  for (const entry of EMAIL_CATALOG) {
    for (const locale of entry.locales) {
      const email = await renderCatalogEmail(entry.id, locale);
      assert.ok(email, `${entry.id}/${locale}`);
      assert.equal(email.locale, locale);
      assert.ok(email.subject.trim().length > 3, `${entry.id}/${locale}: тема`);
      assert.match(email.html, /class="ws-title"/, `${entry.id}/${locale}: общий шаблон`);
      assert.ok(email.text.length > 40, `${entry.id}/${locale}: текстовая версия`);
      assert.doesNotMatch(email.text, /<\/?[a-z][^>]*>|&nbsp;/i, `${entry.id}/${locale}: разметка в тексте`);
      assert.ok(email.preheader && email.preheader.length > 10, `${entry.id}/${locale}: строка во входящих`);
      assert.ok(email.preheader.length <= 140, `${entry.id}/${locale}: строка длиннее 140`);
    }
  }
});

test("каталог: письмо без перевода показывается на русском, неизвестное — null", async () => {
  const ruOnly = EMAIL_CATALOG.find((entry) => entry.locales.length === 1);
  assert.ok(ruOnly);
  const email = await renderCatalogEmail(ruOnly.id, "en");
  assert.equal(email?.locale, "ru");
  assert.equal(findCatalogEntry("nope"), null);
  assert.equal(await renderCatalogEmail("nope", "ru"), null);
});

test("«Прислать мне»: то же письмо на указанную почту, тема с пометкой, вложение счёта на месте", async () => {
  const { result, emails } = await captureOutgoingEmails(() => sendCatalogSample("invoice", "ru", "owner@example.com", "[Образец]"));
  assert.ok(result);
  assert.equal(emails.length, 1);
  const [sample] = emails;
  assert.equal(sample.to, "owner@example.com");
  assert.ok(sample.subject.startsWith("[Образец] "));
  assert.equal(result.subject, sample.subject);
  assert.equal(sample.attachments.length, 1, "PDF счёта");
  assert.ok(Buffer.isBuffer(sample.attachments[0].content) && sample.attachments[0].content.subarray(0, 5).toString() === "%PDF-");
  assert.equal(await sendCatalogSample("nope", "ru", "owner@example.com", "[Образец]"), null);
});

import assert from "node:assert/strict";
import test from "node:test";

import { captureOutgoingEmails, renderEmailLayout, sendVerificationEmail, sendWelcomeEmail } from "@/lib/email";
import { PREHEADER_FILLER, emailHtmlToText, emailPreheaderFromBody, emailPreheaderFromHtml } from "@/lib/email-text";

/**
 * Строка во входящих и текстовая версия писем (спека
 * emails-preheader-text-root-catalog-2026-11-21): рядом с темой почта
 * показывала «wesetup.ru» и повтор темы, а большинство писем уходило только в
 * HTML.
 */

const visibleText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&zwnj;|&nbsp;|&#847;|&#8199;/g, "")
    .replace(/\s+/g, " ")
    .trim();

test("строка во входящих: первая содержательная фраза, без приветствия", () => {
  assert.equal(
    emailPreheaderFromBody('<p style="margin:0 0 16px">Здравствуйте, Анна!</p><p>Вас пригласили в «Ромашку». Задайте пароль по кнопке.</p>'),
    "Вас пригласили в «Ромашку». Задайте пароль по кнопке.",
  );
  for (const greeting of ["Здравствуйте!", "Hello, Anna!", "Assalomu alaykum, Anna!", "Добрый день!"]) {
    assert.equal(emailPreheaderFromBody(`<p>${greeting}</p><p>Суть письма в одной фразе здесь.</p>`), "Суть письма в одной фразе здесь.", greeting);
  }
  // Короткие подписи склеиваются со следующей строкой: «Ваш код:» + код.
  assert.equal(
    emailPreheaderFromBody("<p>Здравствуйте!</p><p>Ваш код подтверждения:</p><div><p>481 205</p></div><p>Код действует 15 минут.</p>"),
    "Ваш код подтверждения: 481 205. Код действует 15 минут.",
  );
  // Строка с двоеточием продолжается следующей: ответ поддержки виден сразу.
  assert.equal(
    emailPreheaderFromBody("<p>Здравствуйте!</p><p>Мы ответили на ваше обращение — Алексей:</p><blockquote>Исправили — обновите страницу.</blockquote>"),
    "Мы ответили на ваше обращение — Алексей: Исправили — обновите страницу.",
  );
  assert.equal(emailPreheaderFromBody("<p>Здравствуйте!</p>"), null, "кроме приветствия ничего нет");
  assert.equal(emailPreheaderFromBody(""), null);
});

test("строка во входящих: не длиннее 110 знаков, обрезка по слову, сущности раскодированы", () => {
  const long = "Пробный период «Ромашки» заканчивается 26 ноября. ".repeat(4);
  const result = emailPreheaderFromBody(`<p>${long}</p>`) ?? "";
  assert.ok(result.length <= 110, `${result.length}`);
  assert.ok(result.endsWith("…"));
  assert.doesNotMatch(result, /\s…$/, "без пробела перед многоточием");
  assert.equal(emailPreheaderFromBody("<p>Цены &mdash; &laquo;как&raquo; раньше &amp; без&nbsp;изменений</p>"), "Цены — «как» раньше & без изменений");
});

test("шаблон: письмо начинается со скрытой строки, за ней невидимое заполнение", () => {
  const html = renderEmailLayout("Приглашение — WeSetup", "<p>Здравствуйте!</p><p>Вас пригласили в «Ромашку» &amp; <b>ждут</b>.</p>");
  const body = html.slice(html.indexOf("<body"));
  assert.match(body, /^<body[^>]*><div style="display:none;[^"]*">Вас пригласили в «Ромашку» &amp; ждут\./);
  assert.ok(body.includes(PREHEADER_FILLER), "заполнение после строки");
  // Что почта покажет рядом с темой: строка, а не «wesetup.ru» и повтор темы.
  assert.ok(visibleText(body).startsWith("Вас пригласили в «Ромашку» &amp; ждут."), visibleText(body).slice(0, 80));
  assert.equal(emailPreheaderFromHtml(html), "Вас пригласили в «Ромашку» & ждут.");
});

test("шаблон: явная строка главнее, спецсимволы экранированы", () => {
  const html = renderEmailLayout("Акция", "<p>Тело письма с первой фразой.</p>", null, { preheader: "Скидка <30%> только сегодня" });
  assert.match(html, /<div style="display:none;[^"]*">Скидка &lt;30%&gt; только сегодня/);
  assert.equal(emailPreheaderFromHtml(html), "Скидка <30%> только сегодня");
  assert.doesNotMatch(html, /Тело письма с первой фразой\.&zwnj;/, "вторая строка не появляется");
});

test("текстовая версия: абзацы, ссылки «текст: адрес», без скрытой строки и разметки", () => {
  const html = renderEmailLayout(
    "Сброс пароля — WeSetup",
    '<p>Здравствуйте!</p><p>Чтобы задать новый пароль, нажмите кнопку.</p><a href="https://wesetup.ru/reset/abc" style="display:inline-block;background:#5566f6">Задать пароль</a><ul><li>Ссылка действует час.</li><li>Не просили — ничего не делайте.</li></ul><p>Вопросы: <a href="mailto:help@wesetup.ru">help@wesetup.ru</a></p>',
  );
  const text = emailHtmlToText(html);
  assert.ok(text.startsWith("wesetup.ru\n\nСброс пароля\n\nЗдравствуйте!"), text.slice(0, 80));
  assert.match(text, /\n\nЗадать пароль: https:\/\/wesetup\.ru\/reset\/abc\n\n/, "кнопка — отдельной строкой");
  assert.match(text, /\n• Ссылка действует час\.\n• Не просили — ничего не делайте\./);
  assert.match(text, /Вопросы: help@wesetup\.ru/, "почта не дублируется адресом mailto:");
  assert.match(text, /© 2026 WeSetup/);
  assert.doesNotMatch(text, /[<>]|&[a-z#0-9]+;|‌|͏| |display:none|@media/);
  assert.doesNotMatch(text, /\n{3,}/);
  assert.ok(!text.includes("Чтобы задать новый пароль, нажмите кнопку. "), "без неразрывных хвостов");
});

test("отправка: у письма без своей текстовой версии она собирается из HTML, своя — сохраняется", async () => {
  const { emails } = await captureOutgoingEmails(async () => {
    await sendVerificationEmail("chef@example.com", "481 205");
    await sendWelcomeEmail({ to: "chef@example.com", name: "Анна", hasAccount: true });
  });
  assert.equal(emails.length, 2, "оба письма перехвачены, ничего не отправлено");
  const [verification, welcome] = emails;
  assert.equal(verification.to, "chef@example.com");
  assert.match(verification.text, /481 205/);
  assert.doesNotMatch(verification.text, /<|&nbsp;/);
  assert.match(verification.html, /<div style="display:none;[^"]*">[^<]*481 205/, "код виден во входящих");
  // Приветственное письмо приходит со своей текстовой версией — её не подменяем.
  assert.ok(welcome.text.length > 50);
  assert.doesNotMatch(welcome.text, /^wesetup\.ru\n/);
});

test("перехват не протекает за пределы вызова", async () => {
  const first = await captureOutgoingEmails(async () => sendVerificationEmail("a@example.com", "111 111"));
  const second = await captureOutgoingEmails(async () => sendVerificationEmail("b@example.com", "222 222"));
  assert.deepEqual(first.emails.map((email) => email.to), ["a@example.com"]);
  assert.deepEqual(second.emails.map((email) => email.to), ["b@example.com"]);
});

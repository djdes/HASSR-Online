import assert from "node:assert/strict";
import test from "node:test";

import { buildBlankDownloadEmail } from "@/lib/email";

/** Письмо со ссылками на скачанный шаблон (AC2): собирается без SMTP. */

test("письмо: ссылка на файл, другой формат, страница журнала и регистрация с почтой", () => {
  const { subject, html } = buildBlankDownloadEmail({
    journalTitle: "Гигиенический журнал",
    files: [
      { label: "Скачать PDF", url: "https://wesetup.ru/api/journal-samples/hygiene/pdf?t=AAA.BBB" },
      { label: "Скачать Word", url: "https://wesetup.ru/api/journal-samples/hygiene/docx?t=CCC.DDD" },
    ],
    pageUrl: "https://wesetup.ru/journals-info/hygiene",
    registerUrl: "https://wesetup.ru/register?email=zav%40example.com&source=blank&journal=hygiene&next=%2Fjournals%2Fhygiene",
    expiresDays: 7,
  });
  assert.equal(subject, "Шаблон «Гигиенический журнал» — WeSetup");
  assert.ok(html.includes('href="https://wesetup.ru/api/journal-samples/hygiene/pdf?t=AAA.BBB"'), "кнопка файла");
  assert.ok(html.includes("скопируйте адрес: https://wesetup.ru/api/journal-samples/hygiene/pdf?t=AAA.BBB"), "адрес текстом");
  assert.ok(html.includes('href="https://wesetup.ru/api/journal-samples/hygiene/docx?t=CCC.DDD"'), "второй формат");
  assert.ok(html.includes('href="https://wesetup.ru/journals-info/hygiene"'), "страница журнала");
  assert.ok(html.includes("source=blank&amp;journal=hygiene"), "регистрация с отметкой источника");
  assert.ok(html.includes("работает 7 дней"));
  assert.ok(html.includes("Если это были не вы"));
});

test("письмо: название экранируется, без страницы журнала блока нет", () => {
  const { subject, html } = buildBlankDownloadEmail({
    journalTitle: 'Журнал <b>"x"</b>',
    files: [{ label: "Скачать PDF", url: "https://wesetup.ru/api/journal-samples/paper/ot_intro/pdf?t=A.B" }],
    pageUrl: null,
    registerUrl: "https://wesetup.ru/register?source=blank",
    expiresDays: 7,
  });
  assert.equal(subject, 'Шаблон «Журнал <b>"x"</b>» — WeSetup');
  assert.ok(!html.includes("<b>\"x\"</b>"));
  assert.ok(html.includes("&lt;b&gt;&quot;x&quot;&lt;/b&gt;"));
  assert.ok(!html.includes("на странице журнала"));
});

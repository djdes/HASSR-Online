import assert from "node:assert/strict";
import test from "node:test";

import { enlargeEmailHtml, renderEmailLayout } from "@/lib/email";

/**
 * Общий шаблон писем (правки владельца 21.11.2026): во всю ширину, без тёмной
 * полосы с невидимым логотипом, заголовок — текстом в яркой полосе, текст и
 * кнопки крупнее (спека emails-redesign-2026-11-21).
 */

const BUTTON = 'style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px"';

test("шаблон: во всю ширину, знак на белом, заголовок текстом в яркой полосе", () => {
  const html = renderEmailLayout("Код подтверждения — WeSetup", `<p style="margin:0;font-size:14px">Код</p><a href="https://wesetup.ru" ${BUTTON}>Войти</a>`, null, {
    footerHtml: '<p style="margin:16px 0;font-size:12px;color:#a1a1aa;text-align:center">Отписаться</p>',
  });
  assert.doesNotMatch(html, /background:#0b1024/, "нет тёмной полосы");
  assert.doesNotMatch(html, /padding:32px 16px/, "нет серых полей вокруг письма");
  assert.match(html, /max-width:600px/);
  assert.match(html, /<body style="margin:0;padding:0;background:#ffffff/);
  // Знак — на белом (тёмный логотип виден); без картинок в полосе остаётся заголовок.
  assert.match(html, /<td class="ws-pad" style="padding:22px 28px 18px">[\s\S]*?brand\/logo-email\.png/);
  assert.match(html, /linear-gradient\(135deg,#5566f6 0%,#7a5cff 100%\)[\s\S]*?<h1[^>]*>Код подтверждения<\/h1>/, "«— WeSetup» из темы в полосу не идёт");
  assert.match(html, /font-size:17px;line-height:1\.55/, "базовый кегль 17 px");
  assert.match(html, /<p style="margin:0;font-size:16px">Код<\/p>/, "14 px тела → 16 px");
  assert.match(html, /padding:15px 28px;border-radius:14px;font-weight:600;font-size:16px/, "кнопка крупнее");
  assert.doesNotMatch(html.slice(html.indexOf("Отписаться") - 200), /text-align:center/, "подвал слева");
  assert.match(html, /<meta name="color-scheme" content="light">/);
});

test("крупнее только мелкое: 11–16 px +2, заголовки и служебные кегли не трогаем", () => {
  assert.equal(enlargeEmailHtml('<p style="font-size:12px">a</p>'), '<p style="font-size:14px">a</p>');
  assert.equal(enlargeEmailHtml('<p style="font-size: 16px">a</p>'), '<p style="font-size:18px">a</p>');
  for (const size of ["1px", "17px", "18px", "32px"]) {
    assert.equal(enlargeEmailHtml(`<p style="font-size:${size}">a</p>`), `<p style="font-size:${size}">a</p>`);
  }
  assert.equal(enlargeEmailHtml("<p>без стилей</p>"), "<p>без стилей</p>");
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractLinks,
  isSafeLinkUrl,
  prepareText,
  substituteVariables,
  toEmailHtml,
  toPlainText,
  toShortText,
  toTelegramHtml,
  usedVariables,
} from "@/lib/mailing/text-format";

const person = { name: "Иван Петров", company: "Кафе «Ромашка»", sphere: "Кафе / Кофейня" };
const empty = { name: null, company: "  ", sphere: undefined };

describe("переменные", () => {
  it("подставляет значения получателя", () => {
    assert.equal(
      substituteVariables("Здравствуйте, {имя}! Для {компания} ({сфера})", person),
      "Здравствуйте, Иван Петров! Для Кафе «Ромашка» (Кафе / Кофейня)"
    );
  });

  it("регистр и пробелы в скобках не важны", () => {
    assert.equal(substituteVariables("{Имя} / { КОМПАНИЯ }", person), "Иван Петров / Кафе «Ромашка»");
  });

  it("пусто — запасное: из текста, из формы, по умолчанию", () => {
    assert.equal(substituteVariables("Привет, {имя|друзья}!", empty), "Привет, друзья!");
    assert.equal(substituteVariables("Привет, {имя}!", empty, { name: "шеф" }), "Привет, шеф!");
    assert.equal(substituteVariables("Привет, {имя}!", empty), "Привет, коллеги!");
    assert.equal(substituteVariables("Для {компания}", empty), "Для ваше заведение");
    // Пустое запасное в тексте — переменная просто исчезает.
    assert.equal(substituteVariables("Привет{имя|}!", empty), "Привет!");
  });

  it("знакомые переменные находит, чужие скобки не трогает", () => {
    assert.deepEqual(usedVariables("{имя} и {компания}, {город}").sort(), ["company", "name"]);
    assert.equal(substituteVariables("{город}", person), "{город}");
  });
});

describe("разметка", () => {
  const text = [
    "Здравствуйте, {имя}!",
    "",
    "Новое в **WeSetup**: [тарифы](https://wesetup.ru/pricing) и https://wesetup.ru/blog.",
    "Вторая строка",
    "",
    "[Кабинет](/dashboard) и [опасно](javascript:alert(1))",
  ].join("\n");

  it("абзацы, перенос, жирный, ссылки — в письмо", () => {
    const html = toEmailHtml(prepareText(text, person));
    assert.equal((html.match(/<p /g) ?? []).length, 3);
    assert.match(html, /Здравствуйте, Иван Петров!/);
    assert.match(html, /<strong>WeSetup<\/strong>/);
    assert.match(html, /<a href="https:\/\/wesetup\.ru\/pricing"[^>]*>тарифы<\/a>/);
    assert.match(html, /<a href="https:\/\/wesetup\.ru\/blog"[^>]*>https:\/\/wesetup\.ru\/blog<\/a>\./);
    assert.match(html, /<br>Вторая строка/);
    assert.match(html, /<a href="\/dashboard"/);
    assert.doesNotMatch(html, /href="javascript/);
    assert.match(html, /\[опасно\]\(javascript:alert\(1\)\)/);
  });

  it("значение переменной не превращается в ссылку и HTML", () => {
    const evil = { name: "<script>x</script>", company: "[Скидка](https://evil.example)", sphere: "**жир**" };
    const prepared = prepareText("{имя} · {компания} · {сфера}", evil);
    const html = toEmailHtml(prepared);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /href="https:\/\/evil/);
    assert.doesNotMatch(html, /<strong>/);
    assert.deepEqual(extractLinks(prepared), []);
  });

  it("адреса ссылок проходят через учёт клика", () => {
    const prepared = prepareText(text, person);
    const html = toEmailHtml(prepared, { linkHref: (u) => `T(${u})` });
    assert.match(html, /href="T\(https:\/\/wesetup\.ru\/pricing\)"/);
    assert.deepEqual(extractLinks(prepared), ["https://wesetup.ru/pricing", "https://wesetup.ru/blog", "/dashboard"]);
  });

  it("текстовая версия и Telegram", () => {
    const prepared = prepareText(text, person);
    const plain = toPlainText(prepared, { linkHref: (u) => u });
    assert.match(plain, /тарифы \(https:\/\/wesetup\.ru\/pricing\)/);
    assert.match(plain, /\n\n/);
    const tg = toTelegramHtml(prepared);
    assert.match(tg, /<b>WeSetup<\/b>/);
    assert.match(tg, /<a href="https:\/\/wesetup\.ru\/pricing">тарифы<\/a>/);
    assert.doesNotMatch(tg, /<p|<br/);
  });

  it("короткий текст без адресов и с обрезкой", () => {
    const short = toShortText(prepareText(text, person), 40);
    assert.equal(short.length <= 40, true);
    assert.equal(short.endsWith("…"), true);
    assert.doesNotMatch(toShortText(prepareText(text, person)), /https:\/\/wesetup\.ru\/pricing/);
  });

  it("ссылка с переменной в адресе остаётся текстом", () => {
    const prepared = prepareText("[кабинет](https://wesetup.ru/{имя})", person);
    assert.doesNotMatch(toEmailHtml(prepared), /<a /);
  });

  it("безопасные адреса ссылок", () => {
    assert.equal(isSafeLinkUrl("https://wesetup.ru/a?b=1"), true);
    assert.equal(isSafeLinkUrl("/pricing"), true);
    assert.equal(isSafeLinkUrl("//evil.example"), false);
    assert.equal(isSafeLinkUrl("javascript:alert(1)"), false);
    assert.equal(isSafeLinkUrl("ftp://x"), false);
  });
});

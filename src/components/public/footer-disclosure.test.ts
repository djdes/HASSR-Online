import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FooterDisclosure } from "./footer-disclosure";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

test("подвал: на телефоне группы свёрнуты, ссылки в HTML, с 640 px всё открыто (правки 21.11.2026)", () => {
  const html = renderToStaticMarkup(
    createElement(FooterDisclosure, { title: "Документы", titleClassName: "title", children: createElement("a", { href: "/oferta" }, "Договор-оферта") }),
  );
  assert.match(html, /<button type="button" aria-expanded="false"[^>]*class="[^"]*sm:hidden"/, "кнопка — только на телефоне");
  assert.match(html, /<div class="title max-sm:hidden">Документы<\/div>/, "заголовок без кнопки — с 640 px");
  assert.match(html, /class="max-sm:hidden"><a href="\/oferta">Договор-оферта<\/a>/, "ссылки в HTML, на телефоне скрыты до нажатия");

  const chrome = read("src/components/public/public-chrome.tsx");
  assert.ok(chrome.includes("<FooterDisclosure key={group.title}"), "группы «Продукт», «Материалы», «Компания», «Документы»");
  assert.ok(chrome.includes("<FooterDisclosure\n        title={title}"), "ряды «Сферы», «Частые журналы», «Возможности»");
  assert.ok(chrome.includes("grid grid-cols-1 text-[13px]") && chrome.includes("sm:grid-cols-4"), "на телефоне — столбцом");
});

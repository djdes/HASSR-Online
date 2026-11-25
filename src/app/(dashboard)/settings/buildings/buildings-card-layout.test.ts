import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { splitForPin } from "./buildings-client";

/*
 * Карточка объекта («Объекты»): скрепка закрепления не остаётся одна в строке
 * (проверка ППК, V10) и не отнимает у названия ширину (проверка мелочей: в
 * флекс-ряду скрепка 48 px сужала название, слова рвались посреди). На
 * телефоне значок и название — обычный текст на всю ширину, скрепка внутри
 * заголовка вместе с последним словом в одном `inline-block max-w-full`: слово
 * и скрепка переходят на новую строку вместе (приклеенная к последней букве
 * скрепка заставляла Chrome рвать длинное последнее слово — проверка, раунд 2;
 * склейку отдельным элементом U+2060 Chrome здесь не соблюдал). С 640 px —
 * отдельная скрепка в конце строки: название, сфера, скрепка, как раньше.
 */

const source = readFileSync(path.join(process.cwd(), "src/app/(dashboard)/settings/buildings/buildings-client.tsx"), "utf8");
const start = source.lastIndexOf("<div", source.indexOf("data-building-title"));
const header = source.slice(start, source.indexOf("{building.address ? ("));

test("последнее слово названия — отдельно: к нему приклеивается скрепка", () => {
  assert.deepEqual(splitForPin("Кафе «Ромашка»"), ["Кафе ", "«Ромашка»"]);
  assert.deepEqual(splitForPin("Цех кондитерский"), ["Цех ", "кондитерский"]);
  assert.deepEqual(splitForPin("Цех №2  "), ["Цех ", "№2"]);
  assert.deepEqual(splitForPin("А"), ["", "А"]);
  assert.deepEqual(splitForPin("Кафе 🍰"), ["Кафе ", "🍰"]);
  assert.deepEqual(splitForPin("Производственнотехнологический"), ["", "Производственнотехнологический"]);
});

test("на телефоне: текстовый поток, скрепка в заголовке вместе с последним словом", () => {
  assert.match(header, /^<div className="min-w-0 sm:contents" data-building-title>/);
  assert.match(header, /<Building2 className="size-4 shrink-0 text-\[#5566f6\] max-sm:mr-2 max-sm:inline-block max-sm:align-\[-0\.125em\]" \/>/);
  assert.match(header, /<h2\s+className="min-w-0 break-words text-\[18px\] font-semibold tracking-\[-0\.01em\] text-\[#0b1024\] max-sm:inline"\s+aria-label=\{onTogglePin \? building\.name : undefined\}/);
  // inline-block: слово и скрепка не разделяются, пока помещаются в строку; max-w-full: шире строки — переносятся внутри, без вылезания.
  // В строке скрепка занимает 28 px (data-touch-compact), зона касания — 48×48 (невидимый ::before на 10 px во все стороны).
  assert.match(header, /\{nameHead\}\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<span className="inline-block max-w-full" data-touch-compact="">\s*\{nameTail\}\s*<PinButton[\s\S]*?className="relative ml-1 align-middle before:absolute before:-inset-2\.5 before:content-\[''\] sm:hidden"/);
  assert.doesNotMatch(header, /whitespace-nowrap/, "неразрывная склейка с буквой рвала длинное слово");
});

test("с 640 px — отдельная скрепка в конце строки; на телефоне она скрыта", () => {
  assert.match(header, /className="max-sm:hidden sm:order-last"/);
  const desktopPin = header.indexOf('className="max-sm:hidden sm:order-last"');
  assert.ok(desktopPin > header.indexOf("</h2>"), "не внутри заголовка");
  assert.ok(desktopPin < header.indexOf("data-building-office"), "в группе, до сферы");
  assert.doesNotMatch(header, /u2060/, "склейка отдельным элементом не работает — её нет");
});

test("сфере больше не нужен max-sm:order-last: она и так после группы", () => {
  assert.doesNotMatch(header, /max-sm:order-last/);
});

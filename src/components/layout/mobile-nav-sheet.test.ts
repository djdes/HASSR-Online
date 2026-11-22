import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * Лист меню на телефоне (владелец, 2026-11-21): «слово меню можно убрать и это
 * место использовать под лого». Название листа остаётся только для экранного
 * диктора, на его месте — бренд организации как в сайдбаре компьютера.
 */

const SHEET = readFileSync("src/components/layout/mobile-nav-sheet.tsx", "utf8");
const BOTTOM = readFileSync("src/components/ui/bottom-sheet.tsx", "utf8");
const SIDEBAR = readFileSync("src/components/layout/app-sidebar-accordion.tsx", "utf8");

test("в шапке листа меню — бренд организации, как в сайдбаре компьютера", () => {
  const header = SHEET.slice(SHEET.indexOf("header={"), SHEET.indexOf("<nav"));
  assert.match(header, /<OrganizationBrand[\s\S]*identity=\{brand\.identity\}[\s\S]*canEditBranding=\{brand\.canEditBranding\}[\s\S]*large/);
  assert.match(header, /data-mobile-nav-brand/);
  // Логотип ведёт на главную и закрывает лист.
  assert.match(header, /onClick=\{closeOnLink\}/);
  // В сайдбаре — тот же компонент с тем же размером.
  assert.match(SIDEBAR, /<OrganizationBrand[\s\S]*large/);
  // Прежней строки с маленьким логотипом в списке больше нет.
  assert.doesNotMatch(SHEET, /OrganizationMark/);
});

test("лист со своей шапкой: заголовок только для диктора, крестик на месте", () => {
  assert.match(BOTTOM, /\{header \? \(/);
  assert.match(BOTTOM, /<Drawer\.Title className="sr-only">\{title\}<\/Drawer\.Title>/);
  assert.match(BOTTOM, /<Drawer\.Close/);
  // Без шапки — видимый заголовок: крупный и жирный, высотой с крестик (2026-11-22).
  assert.match(BOTTOM, /<Drawer\.Title className="truncate text-\[22px\] font-bold leading-10/);
});

/*
 * Меню слева (владелец, 2026-11-22): видимая полоса прокрутки, «Выйти» в
 * меню нет, «Пришла проверка» закреплена внизу и выглядит экстренным
 * действием, а не нажатым пунктом.
 */

const CLASSIC = readFileSync("src/components/layout/app-sidebar-accordion-classic.tsx", "utf8");
const SCROLL = readFileSync("src/components/ui/scroll-list.tsx", "utf8");
const STYLE = readFileSync("src/components/layout/nav-inspection-style.ts", "utf8");

test("в листе меню нет «Выйти»; выход остаётся в листе профиля", () => {
  assert.doesNotMatch(SHEET, /onLogout|data-nav-logout|t\("logout"\)/);
  const header = readFileSync("src/components/layout/header.tsx", "utf8");
  const sheetUse = header.slice(header.indexOf("<MobileNavSheet"), header.indexOf("/>", header.indexOf("<MobileNavSheet")));
  assert.doesNotMatch(sheetUse, /onLogout/);
  assert.match(header, /<ProfileSheet[\s\S]*?onLogout=\{handleLogout\}/);
});

test("видимая полоса прокрутки: лист меню и оба сайдбара — `ScrollPane` с `type=\"auto\"`", () => {
  assert.match(SHEET, /scrollbar\n/);
  assert.match(BOTTOM, /\{scrollbar \? \(\s*<ScrollPane>/);
  assert.match(SCROLL, /export function ScrollPane/);
  assert.match(SCROLL, /<ScrollArea\.Root type="auto"[^>]*data-scroll-pane/);
  assert.match(SCROLL, /data-vaul-no-drag/);
  assert.match(CLASSIC, /<ScrollPane>\s*<div className="flex min-h-full flex-col px-3 pt-4">\s*<ClassicNavAccordion \/>/);
  assert.match(SIDEBAR, /<ScrollPane viewportRef=\{ref\}>/);
  // Прятать полосу больше нечем.
  assert.doesNotMatch(SIDEBAR, /scrollbar-width:none\]\s*\[&::-webkit-scrollbar\]:hidden/);
  // Фокус и прокрутка к пункту не сдвигают весь лист (у vaul под листом `::after` в 200%).
  assert.match(BOTTOM, /flex flex-col overflow-clip rounded-t-3xl/);
});

test("«Пришла проверка» закреплена (sticky сверху и снизу), список раздела идёт следом", () => {
  assert.match(STYLE, /INSPECTION_DOCK =\s*"sticky top-0 bottom-0 z-10/);
  for (const source of [CLASSIC, SIDEBAR]) {
    assert.match(source, /<div\s+data-nav-bottom[\s\S]{0,120}INSPECTION_DOCK/);
    const dock = source.slice(source.indexOf("data-nav-bottom"));
    assert.match(dock, /\{renderRow\(inspection, true\)\}\s*<\/div>\s*\{renderSublist\(inspection\)\}/);
  }
});

test("«Пришла проверка» — не нажатый пункт: в покое без серой заливки, тон предупреждения; в разделе — заливка", () => {
  assert.match(STYLE, /INSPECTION_IDLE =\s*"border border-\[color-mix\(in_srgb,var\(--app-warn-fg\)_24%,transparent\)\] bg-transparent/);
  assert.match(STYLE, /INSPECTION_ACTIVE =\s*"[^"]*bg-\[var\(--app-warn-bg\)\] text-\[var\(--app-warn-fg\)\]"/);
  for (const source of [CLASSIC, SIDEBAR]) {
    assert.match(source, /action \? \((active|inside) \? INSPECTION_ACTIVE : INSPECTION_IDLE\)/);
    assert.doesNotMatch(source, /border border-\[#dcdfed\] bg-white text-\[#0b1024\] shadow/);
    assert.doesNotMatch(source, /active \? "bg-\[#ececef\]" : "bg-\[#f1f1f4\]"/);
  }
  // У щита нет своей плашки и своего тона пункта (правило «один акцент»).
  assert.match(CLASSIC, /data-tone=\{action \? undefined : navTone\(section\.icon\)\}/);
});

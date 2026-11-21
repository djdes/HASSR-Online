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
  // Без шапки — прежний видимый заголовок (остальные листы не меняются).
  assert.match(BOTTOM, /<Drawer\.Title className="truncate text-\[16px\] font-semibold/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * Лист снизу (владелец, 2026-11-22, лист «Объекты»): крупное жирное слово
 * высотой с крестик, без черты над поиском; у выбранного объекта значок без
 * своей плашки — строка уже подсвечена.
 */

const SHEET = readFileSync("src/components/ui/bottom-sheet.tsx", "utf8");
const POINTS = readFileSync("src/components/layout/location-switcher.tsx", "utf8");

test("заголовок листа — 22px жирный, высотой с крестик 40px, по центру с ним", () => {
  assert.match(SHEET, /items-center/);
  assert.match(SHEET, /<Drawer\.Title className="truncate text-\[22px\] font-bold leading-10[^"]*"/);
  const close = SHEET.slice(SHEET.indexOf("<Drawer.Close"), SHEET.indexOf("</Drawer.Close>"));
  assert.match(close, /\bsize-10\b/);
  // Пустое место под крестик у листа со своей шапкой — того же размера.
  assert.match(SHEET, /<span aria-hidden className="size-10 shrink-0" \/>/);
});

test("между шапкой и телом листа нет черты", () => {
  const body = SHEET.slice(SHEET.indexOf("data-sheet-body") - 120, SHEET.indexOf("data-sheet-body"));
  assert.doesNotMatch(body, /border-t/);
  assert.doesNotMatch(SHEET, /MODAL_BODY_CLASS\} border-t/);
});

test("у выбранного объекта значок без своей заливки и рамки", () => {
  const icon = POINTS.slice(POINTS.indexOf("data-point-icon"), POINTS.indexOf("data-point-icon") + 400);
  assert.match(icon, /isActive \? "bg-transparent text-\[#5566f6\]" : "border border-\[#ececf4\] bg-white text-\[#6f7282\]"/);
});

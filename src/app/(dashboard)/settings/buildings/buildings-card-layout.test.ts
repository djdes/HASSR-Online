import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/*
 * Карточка объекта («Объекты»): скрепка закрепления не остаётся одна в строке
 * (проверка ППК, V10). На телефоне значок, название и скрепка — одна
 * неразрывная группа (длинное название переносится внутри неё), сфера/«Офис» —
 * отдельным элементом ниже; с 640 px группа «растворяется» (`sm:contents`) и
 * порядок прежний: название, сфера, скрепка (`sm:order-last`).
 */

const source = readFileSync(path.join(process.cwd(), "src/app/(dashboard)/settings/buildings/buildings-client.tsx"), "utf8");
const header = source.slice(source.indexOf("<Building2 className"), source.indexOf("{building.address ? ("));

test("значок, название и скрепка — одна группа; на широком экране она растворяется в строке", () => {
  const group = source.slice(source.lastIndexOf("<div", source.indexOf("<Building2 className")), source.indexOf("{building.address ? ("));
  assert.match(group, /<div className="flex min-w-0 items-center gap-x-2 sm:contents" data-building-title>/);
  assert.match(header, /<Building2 className="size-4 shrink-0 text-\[#5566f6\]" \/>/);
  assert.match(header, /<PinButton pinned=\{pinned\} onToggle=\{onTogglePin\} name=\{building\.name\} className="shrink-0 sm:order-last" \/>/);
  // Скрепка — внутри группы, до сферы и «Офиса».
  assert.ok(header.indexOf("<PinButton") < header.indexOf("data-building-office"), "скрепка в группе с названием");
});

test("сфере больше не нужен max-sm:order-last: она и так после группы", () => {
  assert.doesNotMatch(header, /max-sm:order-last/);
});

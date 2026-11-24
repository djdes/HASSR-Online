import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Центр шапки («Выберите объект» / объект) не должен уходить под правую
 * группу (логотип, поле «Поиск… Ctrl K», MAX, колокольчик, профиль). С полем
 * поиска правая группа шире своей трети на 1280–1440px: при колонках
 * `1fr auto 1fr` она залезала на переключатель объекта на 16–122px (замер
 * 2026-11-24). Правая колонка — не уже своего содержимого: на широком экране
 * центр стоит ровно посередине, на узком сдвигается влево, а не под кнопки.
 */
test("правая колонка шапки не уже своего содержимого — переключатель объекта не уходит под поиск", () => {
  const header = readFileSync("src/components/layout/header.tsx", "utf8");
  assert.match(header, /grid-cols-\[minmax\(0,1fr\)_minmax\(0,auto\)_minmax\(max-content,1fr\)\]/);
  assert.doesNotMatch(header, /grid-cols-\[minmax\(0,1fr\)_minmax\(0,auto\)_minmax\(0,1fr\)\]/);
});

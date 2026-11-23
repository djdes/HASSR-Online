import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");

test("звёздочка «в избранное» — у пунктов левого меню, строки сверху и её списков, кроме телефона", () => {
  for (const file of ["src/components/layout/app-sidebar-accordion-classic.tsx", "src/components/layout/app-sidebar-accordion.tsx"]) {
    const source = read(file);
    // Правая кнопка мыши — меню «Добавить в избранное» у строк левого меню.
    assert.match(source, /<NavContextMenu href=\{/, file);
    // Под палец звёздочек нет: только на компьютере, при наведении.
    assert.match(source, /touch \? null : <FavoriteStar/, file);
  }
  const top = read("src/components/layout/section-top-menu.tsx");
  assert.ok((top.match(/<FavoriteStar/g) ?? []).length >= 4, "вкладка, строка раздела, пункт и вкладка пункта");
});

test("звёздочка видна при наведении и с клавиатуры, на экранах без наведения — нет", () => {
  const star = read("src/components/favorites/favorite-star.tsx");
  assert.match(star, /group-hover\/fav:opacity-100/);
  assert.match(star, /focus-visible:opacity-100/);
  assert.match(star, /\[@media\(hover:hover\)\]:flex/);
  // Без главной звёздочек нет — их читает только тот, у кого есть «Избранное».
  assert.match(star, /if \(!favorites\.enabled \|\| !favorites\.canStar\(href\)\) return null;/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Шапка на компьютере (владелец, 2026-11-23): поиск сверху есть и в классическом
 * виде, отдельной кнопки «Выйти» рядом с профилем нет, а внизу меню профиля —
 * язык слева и «Выйти» справа (классика и «Новая» тема).
 */
const HEADER = readFileSync("src/components/layout/header.tsx", "utf8");
const NEW_MENU = readFileSync("src/components/layout/new-profile-menu.tsx", "utf8");

test("поиск (Ctrl+K) в шапке — в обоих видах, на компьютере с полем «Поиск…»", () => {
  const buttons = HEADER.match(/<button[^>]*?onClick=\{openCommandPalette\}[\s\S]*?<\/button>/g) ?? [];
  assert.equal(buttons.length, 2, "кнопка поиска у классики и у «Новой» темы");
  const classic = buttons[1];
  assert.match(classic, /data-header-search/);
  assert.match(classic, /sm:inline-flex/);
  assert.match(classic, /lg:w-\[220px\]/);
  assert.match(classic, /tSearch\("field"\)/);
  assert.match(classic, /Ctrl K/);
});

test("отдельной кнопки «Выйти» в шапке нет — выход в меню профиля", () => {
  assert.doesNotMatch(HEADER, /aria-label=\{t\("header\.logout"\)\}/);
  assert.doesNotMatch(HEADER, /import \{[^}]*\bLogOut\b[^}]*\} from "lucide-react"/);
  // Телефон: выход остаётся в листе профиля.
  assert.match(HEADER, /<ProfileSheet[\s\S]*?onLogout=\{handleLogout\}/);
});

function footerOf(source: string): string {
  const marker = source.indexOf('data-testid="profile-menu-footer"');
  assert.ok(marker > 0, "низ меню профиля на месте");
  const start = source.lastIndexOf("<div", marker);
  return source.slice(start, source.indexOf("</div>", source.indexOf('data-testid="profile-logout"')));
}

test("низ меню профиля: язык слева, «Выйти» справа; выше языка нет", () => {
  for (const [name, source] of [["header", HEADER], ["new-profile-menu", NEW_MENU]] as const) {
    const footer = footerOf(source);
    const language = footer.indexOf("<PersonalLanguageSelect compact />");
    const logout = footer.indexOf('data-testid="profile-logout"');
    assert.ok(language > 0 && logout > language, `${name}: язык, потом «Выйти»`);
    assert.match(footer, /justify-between/, `${name}: по краям строки`);
    assert.equal(source.match(/<PersonalLanguageSelect\b/g)?.length, 1, `${name}: язык в меню один раз`);
  }
  // Классика: меню начинается с имени и почты, а не с языка.
  const content = HEADER.slice(HEADER.indexOf('<DropdownMenuContent align="end" className="w-72 p-0">'));
  assert.ok(content.indexOf("<DropdownMenuLabel") < content.indexOf("<PersonalLanguageSelect"));
});

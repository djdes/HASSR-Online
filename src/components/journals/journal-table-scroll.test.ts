import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  DOC_ADD_ROW_CLASS,
  DOC_ADD_ROW_IN_SHEET_CLASS,
  JOURNAL_TABLE_SCROLL_CLASS,
  JOURNAL_TABLE_VIEWPORT_CLASS,
} from "@/components/journals/journal-responsive";
import {
  GRID_VIEWPORT_CLASS,
  GRID_VIEWPORT_WIDE_CLASS,
} from "@/components/journals/journal-grid";

/**
 * Страница документа журнала: вбок прокручивается только таблица — в
 * своей рамке `.journal-table-scroll`, а страница всегда по ширине экрана.
 *
 * Правка владельца 2026-09-28 (iPhone): «попадаешь в центр журнала и
 * приходится постоянно скролить куда-то — надо, чтобы в начале слева
 * сверху». Раньше на телефоне вбок ехала вся страница документа одним
 * листом, а при каждом открытии бланк сам прокручивался к «сегодня».
 *
 * Механика держится на селекторах и классах, а не на типах: вернуть
 * панораму или самописную обёртку можно, ничего не сломав в компиляции.
 * Эти проверки ловят такое до прода.
 */

const CSS = readFileSync("src/app/globals.css", "utf8");
const MINI_CSS = readFileSync("src/app/mini/mini-theme.css", "utf8");
const LAYOUT = readFileSync(
  "src/app/(dashboard)/journals/[code]/documents/[docId]/layout.tsx",
  "utf8"
);
const PAGE = readFileSync(
  "src/app/(dashboard)/journals/[code]/documents/[docId]/page.tsx",
  "utf8"
);
const JOURNALS_DIR = "src/components/journals";
const CLIENT_FILES = readdirSync(JOURNALS_DIR).filter(
  (file) => file.endsWith("-document-client.tsx") || file === "hygiene-v2-table.tsx"
);

/** Комментарии не код: в них законно упоминаются старые классы. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("the document page itself never scrolls sideways", () => {
  assert.match(LAYOUT, /data-journal-doc\b/);
  const code = stripComments(LAYOUT);
  assert.doesNotMatch(code, /overflow-x-(auto|scroll)/);
  assert.doesNotMatch(code, /-mx-4/);
  assert.doesNotMatch(code, /data-journal-doc-pan/);
});

test("breadcrumbs live in the layout, above the page content", () => {
  assert.match(LAYOUT, /JournalPageCrumbs/);
  assert.doesNotMatch(PAGE, /JournalPageCrumbs/);
});

test("one shared table frame: every table viewport token carries it", () => {
  assert.match(JOURNAL_TABLE_SCROLL_CLASS, /\bjournal-table-scroll\b/);
  assert.match(JOURNAL_TABLE_SCROLL_CLASS, /\boverflow-x-auto\b/);
  for (const token of [
    JOURNAL_TABLE_VIEWPORT_CLASS,
    GRID_VIEWPORT_CLASS,
    GRID_VIEWPORT_WIDE_CLASS,
  ]) {
    assert.match(token, /\bjournal-table-scroll\b/);
    // Прокрутку рамки на телефоне больше никто не снимает: её роль
    // раньше брала на себя панорама всей страницы.
    assert.doesNotMatch(token, /max-sm:overflow-visible/);
  }
});

test("document clients use the shared frame, not pan-era wrappers", () => {
  for (const file of CLIENT_FILES) {
    const code = stripComments(readFileSync(path.join(JOURNALS_DIR, file), "utf8"));
    assert.doesNotMatch(code, /max-sm:overflow-visible/, `${file}: прокрутка таблицы снята на телефоне`);
    assert.doesNotMatch(
      code,
      /-mx-4[^"`]*\boverflow-(x-)?auto\b/,
      `${file}: самописная обёртка таблицы — нужен JOURNAL_TABLE_SCROLL_CLASS`
    );
  }
});

test("the global wide-table hack skips the document page", () => {
  const hack = CSS.slice(CSS.indexOf('div:has(table[class*="min-w-"])') - 200);
  assert.match(hack, /main:not\(:has\(\[data-journal-doc\]\)\)/);
});

test("no whole-sheet pan rules remain", () => {
  assert.doesNotMatch(stripComments(CSS), /data-journal-doc-pan/);
  assert.doesNotMatch(stripComments(MINI_CSS), /data-journal-doc-pan/);
  // Липкий ряд «Добавить» внутри листа снова липнет к краю рамки.
  assert.doesNotMatch(stripComments(CSS), /\.sticky\.left-0\s*\{\s*position:\s*static/);
});

test("phone full-bleed frame rules are screen-only and never double-bleed", () => {
  const start = CSS.indexOf("[data-journal-doc] .journal-table-scroll {");
  assert.ok(start > 0, "правило рамки на телефоне пропало");
  const mediaBefore = CSS.lastIndexOf("@media", start);
  assert.match(CSS.slice(mediaBefore, start), /screen and \(max-width: 639px\)/);
  assert.match(
    CSS,
    /\[data-journal-doc\] \.journal-table-scroll \.journal-table-scroll \{\s*margin-inline: 0;/
  );
});

test("no automatic scroll to today when a document opens", () => {
  const scroller = stripComments(
    readFileSync(path.join(JOURNALS_DIR, "focus-today-scroller.tsx"), "utf8")
  );
  assert.doesNotMatch(scroller, /\balways\b/);
  for (const file of CLIENT_FILES) {
    const code = readFileSync(path.join(JOURNALS_DIR, file), "utf8");
    assert.doesNotMatch(code, /<FocusTodayScroller[^>]*\balways\b/, file);
  }
});

test("the add row never rides away with the table", () => {
  assert.ok(DOC_ADD_ROW_IN_SHEET_CLASS.startsWith(DOC_ADD_ROW_CLASS));
  assert.match(DOC_ADD_ROW_IN_SHEET_CLASS, /\bsticky\b/);
  assert.match(DOC_ADD_ROW_IN_SHEET_CLASS, /\bleft-0\b/);
  // На телефоне рамка от края до края — ряд держит отступ текста страницы.
  assert.match(DOC_ADD_ROW_IN_SHEET_CLASS, /max-sm:left-4/);
  // Листы со своей шириной: ряд внутри листа прилипает к краю рамки.
  for (const file of [
    "hygiene-document-client.tsx",
    "health-document-client.tsx",
    "cold-equipment-document-client.tsx",
  ]) {
    const code = readFileSync(path.join(JOURNALS_DIR, file), "utf8");
    assert.match(code, /DOC_ADD_ROW_IN_SHEET_CLASS/, file);
  }
  // Общая оболочка документа: на телефоне бумажная шапка, КАПС-заголовок и
  // ряд «Добавить» стоят над рамкой таблицы (по ширине экрана), а их копии
  // в листе скрыты до 640px — вбок едет только таблица.
  const shell = readFileSync(path.join(JOURNALS_DIR, "journal-document-shell.tsx"), "utf8");
  assert.match(shell, /className="sm:hidden print:hidden"/);
  assert.match(shell, /\$\{DOC_PAPER_HEADER_CLASS\} max-sm:hidden/);
  assert.match(shell, /\$\{DOC_CAPS_TITLE_CLASS\} max-sm:hidden/);
  assert.match(shell, /\$\{DOC_ADD_ROW_CLASS\} max-sm:hidden/);
});

test("description and add button share one row in the document header", () => {
  const row = readFileSync(path.join(JOURNALS_DIR, "document-toolbar-row.tsx"), "utf8");
  // В строку на любой ширине (правка владельца 2026-09-29): ряд не
  // складывается в колонку на телефоне, кнопка не растягивается во всю
  // ширину и не сжимается, на узком экране подпись короткая.
  assert.match(row, /"-mx-4 mb-6 flex items-start gap-3 /);
  assert.doesNotMatch(row, /max-sm:\[&>\*\]:w-full/);
  assert.match(row, /className="flex shrink-0 flex-col items-end/);
  assert.match(row, /max-sm:line-clamp-3/);
  assert.match(row, /<span className="sm:hidden">\{shortLabel\}<\/span>/);
  assert.match(row, /shortLabel = "Добавить"/);
  const climate = readFileSync(path.join(JOURNALS_DIR, "climate-document-client.tsx"), "utf8");
  assert.match(climate, /<DocumentToolbarRow[\s\S]*?description=/);
  assert.match(climate, /<DocumentToolbarRow[\s\S]*?<DocumentToolbarAddButton[\s\S]*?<\/DocumentToolbarRow>/);
});

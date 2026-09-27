import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  JOURNAL_TAB_LINK_CLASS,
  JOURNAL_TAB_RAIL_CLASS,
  JOURNAL_TAB_UNDERLINE_CLASS,
  JOURNAL_TAB_VIEWPORT_CLASS,
} from "@/components/journals/journal-responsive";

/**
 * Страница журнала (владелец, 2026-09-27): «Кнопку QR как-то близко к
 * кнопкам „Создать документ“ — сделать чуть дальше, симметрично. Во
 * вкладке под „Активные“ подчёркивание странное — должно быть ближе, и
 * может полоску убрать… И ещё исправить, чтобы можно было переименовывать
 * нормально… обычное поле сделай».
 *
 * Статические проверки: вёрстку и поведение смотрит e2e задачи
 * `.agent/tasks/journal-page-polish-2026-09`, а здесь — чтобы следующая
 * правка не вернула разнобой.
 */

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const JOURNALS_DIR = "src/components/journals";

/** Строковая константа из исходника (клиентские модули не импортируем в node). */
function constant(file: string, name: string): string {
  const match = new RegExp(`export const ${name} =\\s*"([^"]+)"`).exec(read(file));
  assert.ok(match, `${name} не найдена в ${file}`);
  return match[1];
}

function gapOf(classes: string): string[] {
  return classes.split(/\s+/).filter((c) => /^(sm:|md:|lg:)?gap(-[xy])?-/.test(c));
}

test("вокруг QR-кнопки один шаг: строка «заголовок + блок» и сетка кнопок", () => {
  const actions = "src/components/journals/journal-list-actions.tsx";
  const grid = constant(actions, "JOURNAL_LIST_ACTIONS_GRID_CLASS");
  const row = constant(actions, "JOURNAL_LIST_HEADER_ROW_CLASS");
  // QR ровно посередине: заголовок ↔ QR и QR ↔ ряд — один шаг 20 px;
  // «Создать» ↔ «Инструкция» — 12 px (шире не влезает на телефоне).
  // Было 16 / 8 / 8, потом 12 / 12 / 12 — владелец: «не доделал».
  assert.deepEqual(gapOf(grid), ["gap-x-3", "gap-y-5"]);
  assert.deepEqual(gapOf(row), ["gap-x-3", "gap-y-5"]);
  // Свечение QR-кнопки не съедает зазор под ней.
  assert.match(read(actions), /shadow-\[0_6px_16px_-10px/);

  // Общая шапка берёт ту же строку, что собственные шапки журналов.
  const topBar = read("src/components/journals/document-list-ui.tsx");
  assert.match(topBar, /<div className=\{JOURNAL_LIST_HEADER_ROW_CLASS\}>/);

  // Скелет страницы — те же классы (серверный модуль, строки продублированы).
  const loading = read("src/app/(dashboard)/journals/[code]/loading.tsx");
  assert.ok(loading.includes(`className="${row}"`), "скелет: строка шапки не совпадает");
  assert.ok(loading.includes(`className="${grid}"`), "скелет: сетка кнопок не совпадает");
  assert.match(loading, /className=\{JOURNAL_LIST_STACK_CLASS\}/);
  assert.doesNotMatch(loading, /border-b/, "скелет вкладок без полосы, как JournalTabs");
});

test("вкладки «Активные / Закрытые»: подчёркивание у подписи, без полосы под рядом", () => {
  // Подчёркивание — псевдоэлемент подписи: во всю её ширину, 2 px, в 6 px под текстом.
  assert.match(JOURNAL_TAB_UNDERLINE_CLASS, /after:inset-x-0/);
  assert.match(JOURNAL_TAB_UNDERLINE_CLASS, /after:-bottom-2/);
  assert.match(JOURNAL_TAB_UNDERLINE_CLASS, /after:h-0\.5/);
  // Место под подчёркивание — внутри ссылки: ряд прокручивается вбок и обрезал бы выступ.
  assert.match(JOURNAL_TAB_LINK_CLASS, /\bpb-2\b/);
  for (const token of [JOURNAL_TAB_VIEWPORT_CLASS, JOURNAL_TAB_RAIL_CLASS, JOURNAL_TAB_LINK_CLASS]) {
    assert.doesNotMatch(token, /border-b|pb-5/);
  }

  const ui = read("src/components/journals/document-list-ui.tsx");
  const tabs = ui.slice(ui.indexOf("export function JournalTabs"), ui.indexOf("export function EmptyDocumentsState"));
  assert.ok(tabs.length > 0, "JournalTabs не найден");
  assert.doesNotMatch(tabs, /border-b/, "общая полоса под рядом вкладок вернулась");
  assert.match(tabs, /JOURNAL_TAB_UNDERLINE_CLASS/);
  assert.match(tabs, /aria-current=\{active \? "page" : undefined\}/);
});

test("у всех списков журналов вкладки — общий JournalTabs, самописных копий нет", () => {
  const clients = readdirSync(path.join(ROOT, JOURNALS_DIR))
    .filter((name) => name.endsWith("-documents-client.tsx"))
    .sort();
  assert.ok(clients.length >= 35, `нашлось ${clients.length}`);
  for (const name of clients) {
    const source = read(`${JOURNALS_DIR}/${name}`);
    assert.match(source, /<JournalTabs\b/, `${name}: нет <JournalTabs>`);
    assert.ok(!source.includes("?tab=closed"), `${name}: своя ссылка на «Закрытые»`);
    assert.ok(!/after:bg-\[#5566f6\]/.test(source), `${name}: своё подчёркивание вкладки`);
  }
});

test("переименование журнала — обычное поле: Input, фокус и выделение при открытии", () => {
  const controls = read("src/components/journals/journal-title-controls.tsx");
  assert.match(controls, /import \{ Input \} from "@\/components\/ui\/input";/);
  assert.match(controls, /<Input\b/);
  assert.doesNotMatch(controls, /<input\b/, "самописное поле вместо Input");
  // Ничего, что мешает выделить текст или поставить курсор.
  assert.doesNotMatch(controls, /readOnly|contentEditable|select-none|pointer-events-none|touch-none|user-select/);
  // Фокус и выделение — сразу и на любом устройстве (раньше только при мыши).
  assert.doesNotMatch(controls, /pointer: fine/);
  assert.match(controls, /useLayoutEffect\(\(\) => \{[\s\S]*?input\.focus\(\);[\s\S]*?setSelectionRange\(0, input\.value\.length/);
  // Enter сохраняет (Esc закрывает общий ConfirmDialog).
  assert.match(controls, /event\.key !== "Enter"[\s\S]*?void save\(\);/);

  const dialog = read("src/components/ui/confirm-dialog.tsx");
  // Окно не отбирает фокус у поля, которое уже в фокусе, …
  assert.match(dialog, /!card\.contains\(document\.activeElement\)/);
  // …и на телефоне поднимается над экранной клавиатурой.
  assert.match(dialog, /useKeyboardInset\(open\)/);
  assert.match(dialog, /paddingBottom: keyboardInset/);
  assert.match(dialog, /if \(e\.key !== "Escape" \|\| submitting\) return;/);
  assert.doesNotMatch(dialog, /select-none|touch-none|onTouchMove|onPointerDown/);
});

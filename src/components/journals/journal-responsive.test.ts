import assert from "node:assert/strict";
import test from "node:test";

import {
  DOC_ADD_ROW_CLASS,
  DOC_AUTOFILL_LABEL_CLASS,
  DOC_AUTOFILL_STRIP_CLASS,
  DOC_SECONDARY_BUTTON_CLASS,
  DOC_TITLE_ROW_NO_STRIP_CLASS,
  DOC_CAPS_TITLE_CLASS,
  DOC_EXTRA_BLOCK_CLASS,
  DOC_LEGEND_CLASS,
  DOC_NOTE_TEXT_CLASS,
  DOC_PAPER_CANVAS_CLASS,
  DOC_PAPER_HEADER_CLASS,
  DOC_TITLE_ROW_CLASS,
  JOURNAL_DIALOG_BODY_CLASS,
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_CONTENT_WIDE_CLASS,
  JOURNAL_DIALOG_FIELD_CLASS,
  JOURNAL_DIALOG_FIELD_CONTROL_CLASS,
  JOURNAL_DIALOG_FIELD_LABEL_CLASS,
  JOURNAL_DIALOG_FIELD_TRIGGER_CLASS,
  JOURNAL_DIALOG_FOOTER_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_HINT_CLASS,
  JOURNAL_DIALOG_LABEL_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
  JOURNAL_DOCUMENT_SHELL_CLASS,
  JOURNAL_DOCUMENT_SELECTION_BAR_CLASS,
  JOURNAL_DOCUMENT_SELECTION_BAR_INNER_CLASS,
  JOURNAL_DOCUMENT_SELECTION_BAR_PILL_CLASS,
  JOURNAL_CARD_LABEL_CLASS,
  JOURNAL_CARD_SECTION_CLASS,
  JOURNAL_CARD_TITLE_CLASS,
  JOURNAL_CARD_VALUE_CLASS,
  JOURNAL_LIST_ACTIONS_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_LIST_HEADING_CLASS,
  JOURNAL_TAB_RAIL_CLASS,
  JOURNAL_TAB_VIEWPORT_CLASS,
  REGISTER_DOCUMENT_PAGE_CLASS,
} from "@/components/journals/journal-responsive";

test("journal responsive tokens keep mobile-first stacking and tighter shells", () => {
  assert.match(JOURNAL_LIST_HEADING_CLASS, /w-full/);
  assert.match(JOURNAL_LIST_HEADING_CLASS, /sm:max-w-\[70%\]/);
  assert.match(JOURNAL_LIST_ACTIONS_CLASS, /flex-col/);
  assert.match(JOURNAL_LIST_ACTIONS_CLASS, /sm:flex-row/);
  assert.match(JOURNAL_TAB_VIEWPORT_CLASS, /overflow-x-auto/);
  assert.match(JOURNAL_TAB_RAIL_CLASS, /min-w-max/);
  // Карточка списка: колонкой на мобиле, строкой на десктопе.
  assert.match(JOURNAL_LIST_CARD_CLASS, /\bflex-col\b/);
  assert.match(JOURNAL_LIST_CARD_CLASS, /sm:flex-row/);
  // Полоса выделения закреплена fixed и живёт вне потока страницы,
  // поэтому компенсирующих отрицательных отступов у неё быть не должно.
  assert.doesNotMatch(JOURNAL_DOCUMENT_SELECTION_BAR_CLASS, /-mx-/);
  assert.match(REGISTER_DOCUMENT_PAGE_CLASS, /px-4/);
  assert.match(REGISTER_DOCUMENT_PAGE_CLASS, /sm:px-6/);
});

test("page-level horizontal geometry is declared exactly once", () => {
  // Оболочка документа — прозрачная обёртка на белом фоне раздела.
  // Горизонтальные паддинги задаёт контейнер страницы (max-w-[1800px]
  // px-4 md:px-8 в (dashboard)/layout.tsx и journals/[code]/layout.tsx),
  // поэтому у оболочки их быть не должно — иначе H1 документа уезжает
  // правее хлебных крошек.
  assert.doesNotMatch(JOURNAL_DOCUMENT_SHELL_CLASS, /(^|\s|:)px-\d/);
  assert.doesNotMatch(JOURNAL_DOCUMENT_SHELL_CLASS, /(^|\s|:)-?mx-\d/);
  // Вертикальный ритм оболочки при этом сохраняется.
  assert.match(JOURNAL_DOCUMENT_SHELL_CLASS, /\bpy-3\b/);
  assert.match(JOURNAL_DOCUMENT_SHELL_CLASS, /sm:py-4/);
});

test("journal tokens follow the haccp-online reference typography", () => {
  // H1 эталона — 32px/700 (docs/reference/haccp-online/typography.json).
  assert.match(JOURNAL_LIST_HEADING_CLASS, /text-\[clamp\(1\.75rem,2vw\+1rem,2rem\)\]/);
  assert.match(JOURNAL_LIST_HEADING_CLASS, /font-bold/);
  // Вкладки эталона — 14px/600, один размер на всех брейкпоинтах.
  assert.match(JOURNAL_TAB_RAIL_CLASS, /text-\[14px\]/);
  assert.match(JOURNAL_TAB_RAIL_CLASS, /font-semibold/);
  assert.doesNotMatch(JOURNAL_TAB_RAIL_CLASS, /sm:text-/);
  // R1: контент во всю ширину экрана, потолок — только 1800px.
  assert.match(REGISTER_DOCUMENT_PAGE_CLASS, /max-w-\[1800px\]/);
  assert.doesNotMatch(REGISTER_DOCUMENT_PAGE_CLASS, /max-w-\[1296px\]/);
});

test("document list card matches the reference geometry", () => {
  // Название документа — 16px/700 (S1 аудита), а не 15px/600.
  assert.match(JOURNAL_CARD_TITLE_CLASS, /text-\[16px\]/);
  assert.match(JOURNAL_CARD_TITLE_CLASS, /font-bold/);
  // Мета-колонки прижаты вправо: название забирает всё свободное место.
  assert.match(JOURNAL_LIST_CARD_CLASS, /sm:\[&>:first-child\]:flex-1/);
  assert.match(JOURNAL_LIST_CARD_CLASS, /sm:\[&>:first-child\]:min-w-0/);
  // Разделитель ПЕРЕД первой мета-колонкой снят (S3): линии только между.
  assert.match(JOURNAL_LIST_CARD_CLASS, /sm:\[&>:nth-child\(2\)\]:border-l-0/);
  // A14: мета-колонки всех карточек списка стоят на ОДНОМ x — у секции
  // фиксированная ширина, а не ширина по содержимому (иначе разделители
  // соседних карточек расходились на десятки пикселей). Подпись остаётся
  // в одну строку, значение переносится внутри своей колонки.
  assert.match(JOURNAL_CARD_SECTION_CLASS, /sm:shrink-0/);
  assert.match(JOURNAL_CARD_SECTION_CLASS, /sm:w-\[260px\]/);
  assert.match(JOURNAL_CARD_LABEL_CLASS, /sm:whitespace-nowrap/);
  assert.doesNotMatch(JOURNAL_CARD_VALUE_CLASS, /sm:whitespace-nowrap/);
  // Зазор между карточками — 16px (эталон 14-18px), S4.
  assert.equal(JOURNAL_LIST_CARDS_CLASS, "space-y-4");
});

test("document rhythm tokens follow the canonical block order spacing", () => {
  // H1 → полоса автозаполнения: 20px.
  assert.match(DOC_TITLE_ROW_CLASS, /\bmb-5\b/);
  assert.match(DOC_TITLE_ROW_CLASS, /justify-between/);
  // Полоса → бумажная шапка: 40px, полоса не печатается.
  assert.match(DOC_AUTOFILL_STRIP_CLASS, /\bmb-10\b/);
  assert.match(DOC_AUTOFILL_STRIP_CLASS, /print:hidden/);
  // R1 «единый бланк»: шапка примыкает к титулу и таблице без зазора,
  // титул — компактная строка 8px, ряд «Добавить» — такая же строка py-2.
  // Раньше здесь стояли 28px и 20px, и ХАССП-шапка читалась отдельной
  // карточкой, а не первым блоком одного листа.
  assert.match(DOC_PAPER_HEADER_CLASS, /\bmb-0\b/);
  assert.doesNotMatch(DOC_PAPER_HEADER_CLASS, /\bmb-[1-9]/);
  assert.match(DOC_CAPS_TITLE_CLASS, /\bmy-2\b/);
  assert.doesNotMatch(DOC_CAPS_TITLE_CLASS, /\bmb-5\b/);
  assert.match(DOC_ADD_ROW_CLASS, /\bpy-2\b/);
  assert.doesNotMatch(DOC_ADD_ROW_CLASS, /\bmb-\d/);
  assert.match(DOC_ADD_ROW_CLASS, /items-center/);
  assert.match(DOC_ADD_ROW_CLASS, /print:hidden/);
  // Таблица → легенда: 24px. Легенда → доп. таблица: 32px.
  assert.match(DOC_LEGEND_CLASS, /\bmt-6\b/);
  assert.match(DOC_EXTRA_BLOCK_CLASS, /\bmt-8\b/);
});

test("dialog grid keeps exactly two widths and one typography scale", () => {
  // Эталон (cleaning-02b-filled-dialog.png, cleaning-05-add-room-dialog.png):
  // компактное окно, шапка с линией, заголовок ~18px, поля с подписью сверху.
  assert.match(JOURNAL_DIALOG_CONTENT_CLASS, /sm:max-w-\[480px\]/);
  assert.match(JOURNAL_DIALOG_CONTENT_WIDE_CLASS, /sm:max-w-\[640px\]/);
  // Оба размера — одна и та же оболочка, различие только в ширине.
  assert.equal(
    JOURNAL_DIALOG_CONTENT_CLASS.replace(" sm:max-w-[480px]", ""),
    JOURNAL_DIALOG_CONTENT_WIDE_CLASS.replace(" sm:max-w-[640px]", ""),
  );
  // Крестик закрытия — крупный (24px) и чёрный, как на эталоне (S6).
  assert.match(JOURNAL_DIALOG_CONTENT_CLASS, /dialog-close\]>svg\]:size-6/);
  assert.match(JOURNAL_DIALOG_CONTENT_CLASS, /dialog-close\]\]:text-\[#0b1024\]/);
  // Единственный разделитель окна — линия ПОД заголовком; над подвалом её нет.
  assert.doesNotMatch(JOURNAL_DIALOG_FOOTER_CLASS, /border-t/);
  assert.match(JOURNAL_DIALOG_FOOTER_CLASS, /\bshrink-0\b/);
  assert.match(JOURNAL_DIALOG_CONTENT_CLASS, /\bp-0\b/);
  // Окно не выше 90vh и делится на фикс-шапку + скроллящееся тело,
  // иначе на 900px-экранах кнопка «Создать» уезжает за край без скролла.
  assert.match(JOURNAL_DIALOG_CONTENT_CLASS, /max-h-\[90vh\]/);
  assert.match(JOURNAL_DIALOG_CONTENT_CLASS, /\bflex-col\b/);
  assert.match(JOURNAL_DIALOG_BODY_CLASS, /overflow-y-auto/);
  assert.match(JOURNAL_DIALOG_BODY_CLASS, /\bmin-h-0\b/);
  assert.match(JOURNAL_DIALOG_HEADER_CLASS, /\bshrink-0\b/);
  // Шапка: px-6 py-4 + нижняя линия, заголовок 18px/600, тело px-6 pt-5 pb-8.
  assert.match(JOURNAL_DIALOG_HEADER_CLASS, /\bpx-6\b/);
  assert.match(JOURNAL_DIALOG_HEADER_CLASS, /\bpy-4\b/);
  assert.match(JOURNAL_DIALOG_HEADER_CLASS, /border-b/);
  assert.match(JOURNAL_DIALOG_TITLE_CLASS, /text-\[18px\]/);
  assert.match(JOURNAL_DIALOG_TITLE_CLASS, /font-semibold/);
  assert.match(JOURNAL_DIALOG_BODY_CLASS, /\bpx-6\b/);
  // T1-12: снизу 96px — при прокрутке до конца последнее поле должно
  // полностью выходить из-под непрозрачного фиксированного подвала.
  assert.match(JOURNAL_DIALOG_BODY_CLASS, /\bpt-5\b/);
  assert.match(JOURNAL_DIALOG_BODY_CLASS, /\bpb-24\b/);
  assert.match(JOURNAL_DIALOG_LABEL_CLASS, /text-\[13px\]/);
});

test("selection bar sticks under the app header and never prints", () => {
  // `sticky` прилипал только к ближайшему скроллящемуся предку и терялся
  // внутри overflow-viewport'ов журнальных таблиц. Полоса закреплена
  // жёстко: fixed под шапкой кабинета (её высота ровно 72px — см.
  // src/components/layout/header.tsx), z-40 выше липких заголовков таблиц.
  assert.match(JOURNAL_DOCUMENT_SELECTION_BAR_CLASS, /\bfixed\b/);
  assert.doesNotMatch(JOURNAL_DOCUMENT_SELECTION_BAR_CLASS, /\bsticky\b/);
  assert.match(JOURNAL_DOCUMENT_SELECTION_BAR_CLASS, /top-\[72px\]/);
  // Слева — от края сайдбара (меню кабинета, 2026-10-16), справа — до края.
  assert.match(JOURNAL_DOCUMENT_SELECTION_BAR_CLASS, /left-\[var\(--app-sidebar-w,0px\)\]/);
  assert.match(JOURNAL_DOCUMENT_SELECTION_BAR_CLASS, /\bright-0\b/);
  assert.doesNotMatch(JOURNAL_DOCUMENT_SELECTION_BAR_CLASS, /inset-x-0/);
  assert.match(JOURNAL_DOCUMENT_SELECTION_BAR_CLASS, /\bz-40\b/);
  assert.match(JOURNAL_DOCUMENT_SELECTION_BAR_CLASS, /print:hidden/);
  // Горизонтально — ровно по контентной колонке страницы.
  assert.match(JOURNAL_DOCUMENT_SELECTION_BAR_INNER_CLASS, /max-w-\[1800px\]/);
  assert.match(JOURNAL_DOCUMENT_SELECTION_BAR_INNER_CLASS, /\bpx-4\b/);
  assert.match(JOURNAL_DOCUMENT_SELECTION_BAR_INNER_CLASS, /md:px-8/);
  // Сама «пилюля» — белая с blur, чтобы читаться поверх таблицы.
  assert.match(JOURNAL_DOCUMENT_SELECTION_BAR_PILL_CLASS, /backdrop-blur/);
  assert.match(JOURNAL_DOCUMENT_SELECTION_BAR_PILL_CLASS, /bg-white\/95/);
});

test("dialog fields are one full-width column with floating labels", () => {
  // Эталон cleaning-02b / climate_control-create-fail: рамка поля во всю
  // ширину окна, подпись мелким кеглем ВНУТРИ рамки сверху.
  assert.match(JOURNAL_DIALOG_FIELD_CLASS, /\bw-full\b/);
  assert.match(JOURNAL_DIALOG_FIELD_CLASS, /rounded-\[14px\]/);
  assert.match(JOURNAL_DIALOG_FIELD_LABEL_CLASS, /text-\[11\.5px\]/);
  // Контролы внутри рамки своей рамки/фона не имеют — иначе рамка в рамке.
  assert.match(JOURNAL_DIALOG_FIELD_CONTROL_CLASS, /border-0/);
  assert.match(JOURNAL_DIALOG_FIELD_CONTROL_CLASS, /bg-transparent/);
  // Главный фикс селектов: `SelectTrigger` по умолчанию `w-fit` и
  // схлопывался в пустую пилюлю ~50px — здесь он всегда во всю ширину.
  assert.match(JOURNAL_DIALOG_FIELD_TRIGGER_CLASS, /\bw-full\b/);
  assert.doesNotMatch(JOURNAL_DIALOG_FIELD_TRIGGER_CLASS, /\bw-fit\b/);
  // Подсказка «нет сотрудников на должности» — заметная, не серый микротекст.
  assert.match(JOURNAL_DIALOG_HINT_CLASS, /bg-\[#fff8e8\]/);
});

test("paper canvas spans the full content column", () => {
  // R1: своей max-w у бланка больше нет — горизонтальную геометрию
  // задаёт ровно один контейнер, `journals/[code]/layout.tsx`
  // (max-w-[1800px] + px-4 md:px-8). Прежние 1150px владелец назвал
  // «узко»: бумага висела островом посреди широкой страницы.
  assert.doesNotMatch(DOC_PAPER_CANVAS_CLASS, /max-w-\[\d+px\]/);
  assert.match(DOC_PAPER_CANVAS_CLASS, /\bmx-auto\b/);
  assert.match(DOC_PAPER_CANVAS_CLASS, /\bw-full\b/);
  // На печати ограничение снимается — лист задаёт @page.
  assert.match(DOC_PAPER_CANVAS_CLASS, /print:max-w-none/);
});

test("explanatory notes use the paper type scale, not UI 16px", () => {
  // S9/Z2 аудита: пояснения под таблицами у эталона 12-13px с
  // интерлиньяжем ~1.4; было 16px/28px — блоки выходили вдвое выше.
  assert.match(DOC_NOTE_TEXT_CLASS, /text-\[12\.5px\]/);
  assert.match(DOC_NOTE_TEXT_CLASS, /leading-\[1\.4\]/);
});

test("autofill strip keeps the reference height", () => {
  // H5 аудита: полоса ~48px = штатный тумблер 44×24 + 12px паддинга.
  assert.match(DOC_AUTOFILL_STRIP_CLASS, /\bpy-3\b/);
  assert.doesNotMatch(DOC_AUTOFILL_STRIP_CLASS, /sm:py-4/);
  assert.match(DOC_AUTOFILL_STRIP_CLASS, /min-h-\[48px\]/);
});

test("autofill strip is one full-bleed ribbon, never a rounded card", () => {
  // Q3: эталон рисует ОДНУ ленту во всю ширину контентной колонки —
  // без скругления и без собственной рамки. До этого журналы держали
  // r32+p-8 (cold_equipment), r28 (вентиляция), r24 (климат), рамку
  // и фон #f5f6ff (уборка) — полоса выглядела по-разному на каждой
  // странице.
  assert.match(DOC_AUTOFILL_STRIP_CLASS, /-mx-4/);
  assert.match(DOC_AUTOFILL_STRIP_CLASS, /md:-mx-8/);
  assert.match(DOC_AUTOFILL_STRIP_CLASS, /bg-\[#f3f4fe\]/);
  assert.doesNotMatch(DOC_AUTOFILL_STRIP_CLASS, /rounded/);
  assert.doesNotMatch(DOC_AUTOFILL_STRIP_CLASS, /\bborder\b/);
  // Зазор тумблер → подпись — 12px, один на все 13 журналов.
  assert.match(DOC_AUTOFILL_STRIP_CLASS, /\bflex\b/);
  assert.match(DOC_AUTOFILL_STRIP_CLASS, /\bitems-center\b/);
  assert.match(DOC_AUTOFILL_STRIP_CLASS, /\bgap-3\b/);
  assert.doesNotMatch(DOC_AUTOFILL_STRIP_CLASS, /\bgap-4\b/);
  // Подпись — 15px/600.
  assert.match(DOC_AUTOFILL_LABEL_CLASS, /text-\[15px\]/);
  assert.match(DOC_AUTOFILL_LABEL_CLASS, /font-semibold/);
});

test("journals without the strip keep a single 28px title gap", () => {
  // Q3: было 28/49/52/81 — каждый такой журнал добирал зазор своей
  // обёрткой с `py-*`. Теперь один override-токен на строку заголовка.
  assert.equal(DOC_TITLE_ROW_NO_STRIP_CLASS, "mb-7");
});

test("secondary row button matches the primary 44px row height", () => {
  // Q3: «Редактировать список(и)» жила в пяти спецификациях
  // (44/40/36/36px, три фона, три кегля). Ряд «Добавить» — один рост.
  assert.match(DOC_SECONDARY_BUTTON_CLASS, /\bh-11\b/);
  assert.match(DOC_SECONDARY_BUTTON_CLASS, /rounded-lg/);
  assert.match(DOC_SECONDARY_BUTTON_CLASS, /bg-\[#f5f6ff\]/);
  assert.match(DOC_SECONDARY_BUTTON_CLASS, /hover:bg-\[#eef0ff\]/);
  assert.match(DOC_SECONDARY_BUTTON_CLASS, /text-\[15px\]/);
  assert.match(DOC_SECONDARY_BUTTON_CLASS, /font-semibold/);
  assert.match(DOC_SECONDARY_BUTTON_CLASS, /text-\[#5566f6\]/);
});

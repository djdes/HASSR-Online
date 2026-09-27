/**
 * H1 списка журнала. Масштаб эталона lk.haccp-online.ru: 32px/700
 * (docs/reference/haccp-online/typography.json → listPage.h1). clamp
 * оставлен ради узких экранов, верхняя граница — ровно 2rem = 32px.
 */
export const JOURNAL_LIST_HEADING_CLASS =
  "w-full text-[clamp(1.75rem,2vw+1rem,2rem)] font-bold leading-tight tracking-[-0.02em] text-[#0b1024] sm:max-w-[70%]";

/**
 * Ритм страницы СПИСКА документов журнала (эталон: hygiene-grid.png).
 *
 * Порядок: крошки → строка «H1 слева + Инструкция/Создать документ справа»
 * → вкладки «Активные/Закрытые» → карточки документов. Один шаг 32px
 * между всеми тремя блоками — на всех 13 журналах одинаково.
 */
export const JOURNAL_LIST_STACK_CLASS = "space-y-8";

export const JOURNAL_LIST_ACTIONS_CLASS =
  "flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center";

/*
 * Вкладки «Активные / Закрытые» списка документов — ОДИН компонент
 * `JournalTabs` (document-list-ui.tsx) у всех журналов; самописные копии
 * запрещает `journal-page-polish.test.ts`.
 *
 * Владелец, 2026-09-27: «Во вкладке под „Активные“ подчёркивание странное —
 * должно быть ближе, и может полоску убрать». Было: подчёркивание висело
 * в 19–21 px под текстом (у ссылки `pb-5`), в 3 px над серой полосой во
 * всю ширину ряда и в 19 копиях с разными отступами. Стало: подчёркивание
 * у самой подписи — по её ширине, 6 px под текстом; общей полосы нет.
 */
export const JOURNAL_TAB_VIEWPORT_CLASS =
  "overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** Вкладки эталона — 14px/600 на всех брейкпоинтах. */
export const JOURNAL_TAB_RAIL_CLASS =
  "flex min-w-max gap-8 text-[14px] font-semibold sm:gap-12";

/**
 * Ссылка-вкладка. `pb-2` — место под подчёркивание внутри самой ссылки:
 * ряд прокручивается вбок (`overflow-x-auto`) и обрезал бы всё, что
 * выступает за его край. Высота на телефоне — общее правило 48 px
 * (app-theme.css), подпись в ней по центру, подчёркивание едет с ней.
 */
export const JOURNAL_TAB_LINK_CLASS =
  "relative flex items-center gap-1.5 rounded-md pb-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

export const JOURNAL_TAB_ACTIVE_CLASS = "text-[#0b1024]";

export const JOURNAL_TAB_INACTIVE_CLASS = "text-[#6f7282] hover:text-[#0b1024]";

/**
 * Подпись вкладки. У активной — подчёркивание: ширина подписи, 2 px,
 * верх линии в 6 px под текстом (`-bottom-2` = 8 px минус толщина).
 * Подчёркивание привязано к подписи, а не к ссылке: иначе на телефоне
 * (ссылка 48 px) оно уезжало бы от текста к низу ссылки.
 */
export const JOURNAL_TAB_LABEL_CLASS = "relative";

export const JOURNAL_TAB_UNDERLINE_CLASS =
  "after:absolute after:inset-x-0 after:-bottom-2 after:h-0.5 after:rounded-full after:bg-[#5566f6]";

/**
 * Карточка документа в списке журнала — геометрия эталона
 * lk.haccp-online.ru (hygiene-1-list.png, cleaning-1-list.png):
 *
 *   [ Название (жирное, занимает всё свободное место) ][ мета ][ мета ][ ⋯ ]
 *
 * Ключевые отличия от прежней grid-раскладки
 * (`sm:grid-cols-[1fr_200px_200px_48px]`):
 *
 * 1. Не grid, а flex: мета-колонки получают ширину ПО СОДЕРЖИМОМУ
 *    (`sm:shrink-0` + nowrap в JOURNAL_CARD_SECTION_CLASS), поэтому
 *    «Должность ответственного» и «Управляющий: Администратор» больше не
 *    переносятся в две строки и карточка держит 66-76px вместо 94-118px.
 * 2. Первый ребёнок (название) — `flex-1 min-w-0`: мета-колонки
 *    автоматически прижаты ВПРАВО к меню «⋯», как на эталоне. Правило
 *    живёт здесь, а не в JOURNAL_CARD_TITLE_CLASS, потому что часть
 *    журналов вешает типографику названия на вложенный `<div>` внутри
 *    `<Link>`, и flex-элементом там оказывается именно ссылка.
 * 3. У ВТОРОГО ребёнка (первая мета-колонка) вертикальный разделитель
 *    снят: линии рисуются только МЕЖДУ мета-колонками. На мобиле
 *    горизонтальные разделители остаются у всех секций.
 */
export const JOURNAL_LIST_CARD_CLASS =
  "flex flex-col gap-3 rounded-2xl border border-[#ececf4] bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:gap-0 sm:px-5 sm:[&>:first-child]:min-w-0 sm:[&>:first-child]:flex-1 sm:[&>:nth-child(2)]:border-l-0";

/**
 * Shared card typography (list of documents inside a journal). Normalized
 * across every *-documents-client.tsx so every journal card looks the same
 * as the climate_control card used as the reference.
 *
 * Название документа — 16px/700 тёмным, как на эталоне (S1 аудита).
 */
export const JOURNAL_CARD_TITLE_CLASS =
  "text-[16px] font-bold leading-[1.35] tracking-[-0.02em] text-black [overflow-wrap:anywhere]";

export const JOURNAL_CARD_LABEL_CLASS =
  "text-[12.5px] leading-[1.3] text-[#84849a] sm:whitespace-nowrap";

/**
 * A14: `sm:whitespace-nowrap` снят. Секции карточки теперь имеют общую
 * фиксированную ширину (см. `JOURNAL_CARD_SECTION_CLASS`), и длинное
 * значение вроде «Повар горячего цеха: лорлорол» обязано переноситься,
 * а не вылезать за колонку. Подпись (LABEL) остаётся в одну строку —
 * она короткая и держит ритм колонки.
 */
export const JOURNAL_CARD_VALUE_CLASS =
  "mt-1 text-[13.5px] font-semibold leading-[1.35] text-black";

/**
 * Shared section divider used between title → label/value blocks in the
 * document list card. Horizontal line + top padding on mobile, vertical
 * line + left padding on desktop. On desktop the content is laid out as
 * a flex column centered vertically so label/value sits exactly between
 * the vertical dividers regardless of cell height differences.
 *
 * A14 аудита: секция получила ФИКСИРОВАННУЮ ширину (`sm:w-[260px]`).
 *
 * Раньше стоял только `sm:shrink-0` — ширина по содержимому, поэтому у
 * каждой карточки списка мета-колонки вставали на СВОЁМ x: в списке
 * уборки вертикальные разделители соседних карточек расходились на
 * 943px и 989px, и колонка «Период»/«Статус» гуляла по вертикали.
 * Карточки — это сетка, а не независимые плитки, поэтому колонка одна
 * для всех: 260px хватает и «Август с 1 по 15», и «Повар горячего цеха:
 * лорлорол». У значения снят `whitespace-nowrap` — при переполнении оно
 * переносится, а не вылезает за колонку.
 *
 * `shrink-0` остаётся: сжимать колонку под длинное название документа
 * нельзя, название переносится само.
 */
export const JOURNAL_CARD_SECTION_CLASS =
  "border-t border-[#e6e6f0] pt-3 sm:flex sm:w-[260px] sm:shrink-0 sm:flex-col sm:justify-center sm:border-l sm:border-t-0 sm:px-6 sm:pt-0";

/** Вертикальный зазор между карточками списка — 16px (эталон 14-18px). */
export const JOURNAL_LIST_CARDS_CLASS = "space-y-4";

/**
 * Полоса «выбрано N строк» — ЗАКРЕПЛЕНА ЖЁСТКО.
 *
 * Раньше стояло `sticky top-[72px]`, но sticky «прилипает» только к
 * ближайшему скроллящемуся предку: внутри `overflow-x-auto`-viewport'ов
 * журнальных таблиц полоса уезжала вместе с содержимым и терялась.
 * Теперь это `position: fixed` под шапкой кабинета (её высота — ровно
 * 72px, см. `src/components/layout/header.tsx`), поэтому действия над
 * выделением видны при ЛЮБОМ скролле.
 *
 * z-40 — выше липких заголовков таблиц (z-10/z-20) и на уровень выше
 * шапки (z-30), с которой полоса не пересекается по вертикали.
 * При пустом выделении компонент вообще не рендерится, в печать не идёт.
 */
export const JOURNAL_DOCUMENT_SELECTION_BAR_CLASS =
  "fixed inset-x-0 top-[72px] z-40 print:hidden";

/**
 * Внутренняя «пилюля» полосы: ровно по ширине контентной колонки страницы
 * (max-w-[1800px] + те же px-4 md:px-8, что у `(dashboard)/layout.tsx`),
 * чтобы полоса совпадала по левому/правому краю с содержимым документа.
 */
export const JOURNAL_DOCUMENT_SELECTION_BAR_INNER_CLASS =
  "mx-auto w-full max-w-[1800px] px-4 pt-2 md:px-8";

/** Сама «пилюля» действий — белая, с blur и тенью поверх таблицы. */
export const JOURNAL_DOCUMENT_SELECTION_BAR_PILL_CLASS =
  "flex flex-wrap items-center gap-3 rounded-[14px] border border-[#dcdfed] bg-white/95 px-4 py-3 shadow-[0_8px_24px_rgba(40,45,86,0.08)] backdrop-blur";

/**
 * Оболочка документа. Раньше несла border + shadow — на сером фоне это
 * читалось как «лист бумаги». Теперь фон раздела журналов сам белый
 * (см. `journals/[code]/layout.tsx`), поэтому рамка вокруг белого на
 * белом была бы «рамкой ради рамки» — убрана, как на эталоне.
 *
 * Горизонтальные отступы тоже убраны: на белом фоне это прозрачная
 * обёртка, а её `px-4 sm:px-6 lg:px-8` были ВТОРЫМ слоем padding'а поверх
 * контейнера страницы и сдвигали H1 документа правее хлебных крошек.
 * Горизонтальную геометрию задаёт ровно один контейнер — страница.
 * Остались только вертикальные отступы.
 */
export const JOURNAL_DOCUMENT_SHELL_CLASS =
  "rounded-[20px] bg-white py-3 sm:py-4 lg:py-5";

export const JOURNAL_DOCUMENT_HEADER_CLASS =
  "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-5";

export const JOURNAL_DOCUMENT_ACTIONS_CLASS =
  "flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end sm:gap-3";

/**
 * Viewport таблицы.
 *
 * На мобильном СВОЕГО горизонтального скролла у таблицы нет: документ
 * листается целиком (см. `DOC_PAPER_CANVAS_CLASS`). Раньше каждая
 * таблица скроллилась сама по себе, и документ разваливался на куски —
 * сдвинув вбок одну таблицу, человек видел её не на том месте
 * относительно соседней, а потянув за текст между ними, не двигал
 * ничего.
 *
 * На `sm+` поведение прежнее: скроллится сама таблица.
 */
export const JOURNAL_TABLE_VIEWPORT_CLASS =
  "max-sm:overflow-visible overflow-x-auto sm:mx-0 sm:px-0 rounded-[14px] bg-white";

/* ------------------------------------------------------------------ *
 * Единая сетка модальных окон журналов
 * ------------------------------------------------------------------ *
 *
 * Эталон lk.haccp-online.ru (cleaning-02b-filled-dialog.png,
 * cleaning-05-add-room-dialog.png, staff-05-add-employee-form.png):
 * окно компактное (~480-560px), шапка с нижней линией, заголовок ~18-20px,
 * поля с подписью НАД инпутом, кнопка действия справа внизу.
 *
 * До этой правки в 13 журналах жили ширины 480/520/560/620/640/720/760/
 * 840/860/900/970/980, заголовки 18/20/22/24/42px и паддинги
 * px-6…px-18 — то есть каждый диалог был «свой». Держим ровно два
 * размера: обычный (560) и широкий, под редакторы таблиц/списков (640).
 */
/**
 * Окно НИКОГДА не выше 90vh (правило WhatsNewModal из CLAUDE.md): на
 * ноутбучных 900px диалог «Создание документа» бракеража перерастал экран
 * и кнопка «Создать» оказывалась за краем без возможности доскроллить.
 *
 * Геометрия: `flex flex-col` — шапка (`JOURNAL_DIALOG_HEADER_CLASS`) и
 * подвал (`JOURNAL_DIALOG_FOOTER_CLASS`) `shrink-0`, тело
 * (`JOURNAL_DIALOG_BODY_CLASS`) — `flex-1 min-h-0 overflow-y-auto`.
 * `overflow-y-auto` на самой карточке оставлен как страховка для дюжины
 * диалогов, которые верстают тело своей разметкой без BODY-класса: там
 * скроллится карточка целиком, как и раньше.
 */
/**
 * Крестик закрытия. `<DialogContent>` рисует его сам (см.
 * `src/components/ui/dialog.tsx`) мелким серым 16px — на эталоне это
 * крупный чёрный ~24px крест, выровненный по заголовку шапки.
 * Переопределяем прямо из класса окна: селектор
 * `.<окно> button[data-slot=dialog-close] > svg` специфичнее
 * дефолтного `[&_svg:not([class*='size-'])]:size-4` (0,2,2 против 0,2,1),
 * поэтому размер применяется независимо от порядка правил в бандле.
 */
const JOURNAL_DIALOG_CLOSE_CLASS =
  "[&_button[data-slot=dialog-close]]:top-[18px] [&_button[data-slot=dialog-close]]:right-5 [&_button[data-slot=dialog-close]]:rounded-lg [&_button[data-slot=dialog-close]]:text-[#0b1024] [&_button[data-slot=dialog-close]]:opacity-100 [&>button[data-slot=dialog-close]>svg]:size-6";

const JOURNAL_DIALOG_SHELL_CLASS =
  `flex w-[calc(100vw-2rem)] max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-y-auto overscroll-contain rounded-[24px] border-0 p-0 shadow-[0_24px_80px_rgba(40,45,86,0.16)] ${JOURNAL_DIALOG_CLOSE_CLASS}`;

/** Обычное окно — 480px, ровно как на живом эталоне (S6 аудита). */
export const JOURNAL_DIALOG_CONTENT_CLASS =
  `${JOURNAL_DIALOG_SHELL_CLASS} sm:max-w-[480px]`;

/** Широкое окно — только редакторы таблиц/списков внутри документа. */
export const JOURNAL_DIALOG_CONTENT_WIDE_CLASS =
  `${JOURNAL_DIALOG_SHELL_CLASS} sm:max-w-[640px]`;

/** Шапка окна: подпись слева, крестик справа, нижняя линия. */
export const JOURNAL_DIALOG_HEADER_CLASS =
  // `sticky top-0` — страховка для окон, у которых нет отдельного
  // скроллящегося тела: шапка с крестиком остаётся на виду, даже когда
  // прокручивается карточка целиком.
  "sticky top-0 z-10 flex shrink-0 flex-row items-center justify-between gap-4 border-b border-[#ececf4] bg-white px-6 py-4";

/** Заголовок окна — 18px/600, один размер во всех журналах. */
export const JOURNAL_DIALOG_TITLE_CLASS =
  "text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]";

/**
 * Тело окна — единственная скроллящаяся зона диалога.
 *
 * A17 аудита: нижний отступ увеличен с 20px до 32px. Подвал
 * (`JOURNAL_DIALOG_FOOTER_CLASS`) непрозрачный и `shrink-0`, поэтому при
 * прокрутке до конца последнее поле упиралось прямо в кнопку «Создать» и
 * читалось как перекрытое ей (диалог создания документа бракеража — там
 * полей больше десятка). 32px дают ту же «воздушную» границу, что и
 * между полями.
 */
/*
 * R5-12: нижний отступ 32px → 96px (`pb-8` → `pb-24`).
 *
 * Подвал окна (`JOURNAL_DIALOG_FOOTER_CLASS`) непрозрачный и `shrink-0`,
 * то есть физически стоит НАД скролл-зоной. При 32px последний блок
 * длинной формы («Добавить поля» в бракераже готовой продукции —
 * полтора десятка тумблеров) доезжал ровно под кнопку «Создать» и
 * читался как обрезанный ею: пользователь не понимал, что форма
 * закончилась, и искал, куда делся хвост.
 *
 * 96px ≈ высота подвала (кнопка 40px + `pb-5`/`pt-1`) плюс воздух,
 * поэтому в конце прокрутки последнее поле стоит ВЫШЕ кнопки с
 * запасом. Плата — тот же зазор в коротких окнах, где скролла нет;
 * это осознанный размен: пустое место внизу диалога безобидно,
 * потерянное поле — нет.
 */
export const JOURNAL_DIALOG_BODY_CLASS =
  "min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 pb-24 pt-5";

/**
 * Подвал окна: действие справа внизу, как на эталоне.
 *
 * Верхней линии у подвала НЕТ (S6 аудита): единственный разделитель окна —
 * линия ПОД заголовком (`JOURNAL_DIALOG_HEADER_CLASS`). Подвал при этом
 * остаётся фиксированным (`shrink-0`) — механика скролла тела не меняется.
 */
export const JOURNAL_DIALOG_FOOTER_CLASS =
  "sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center justify-end gap-2 bg-white px-6 pb-5 pt-1";

/** Подпись поля НАД инпутом — 13px/500. Legacy: новые поля используют
 * floating label внутри рамки (JOURNAL_DIALOG_FIELD_*). */
export const JOURNAL_DIALOG_LABEL_CLASS = "text-[13px] font-medium text-[#3c4053]";

/* ------------------------------------------------------------------ *
 * Поле диалога: floating label ВНУТРИ рамки
 * ------------------------------------------------------------------ *
 *
 * Эталон lk.haccp-online.ru (cleaning-02-create-dialog.png,
 * cleaning-02b-filled-dialog.png, climate_control-create-fail.png,
 * hygiene-create-fail.png): у каждого поля рамка одной ширины (full-width),
 * подпись мелким кеглем прижата к верхнему краю рамки и НЕ исчезает при
 * заполнении, значение — 15px под ней.
 *
 * До этой правки в диалогах жили три разных манеры: «Label над инпутом»,
 * «плейсхолдер вместо подписи» и «Label + тот же текст плейсхолдером»,
 * а селекты рендерились `w-fit`-пилюлями по ширине контента (50-190px)
 * рядом с full-width textarea — правый край формы был рваным.
 *
 * Компоненты, которые эти токены собирают: `journal-dialog-field.tsx`.
 */

/** Рамка поля. Всегда full-width — одна колонка на весь диалог. */
export const JOURNAL_DIALOG_FIELD_CLASS =
  "w-full rounded-[14px] border border-[#dfe1ec] bg-white px-3.5 pt-1.5 pb-2 transition-colors duration-150 focus-within:border-[#5566f6] focus-within:ring-4 focus-within:ring-[#5566f6]/15";

/** Та же рамка в состоянии ошибки — как на hygiene-create-fail.png. */
export const JOURNAL_DIALOG_FIELD_INVALID_CLASS =
  "border-[#e5484d] focus-within:border-[#e5484d] focus-within:ring-[#e5484d]/15";

/** Floating label внутри рамки — 11.5px, всегда виден. */
export const JOURNAL_DIALOG_FIELD_LABEL_CLASS =
  "block text-[11.5px] leading-[1.35] font-normal text-[#8a8fa3]";

/**
 * Инпут внутри рамки: своей рамки/фона/тени нет — их даёт контейнер.
 * `touch:min-h-0` — на телефоне общий минимум 48px (app-theme.css) здесь
 * не нужен: цель нажатия — рамка поля (≈ 60px вместе с подписью), а
 * вытянутый инпут раздувал каждое поле на 20px пустоты.
 */
export const JOURNAL_DIALOG_FIELD_CONTROL_CLASS =
  "h-7 w-full min-w-0 rounded-none border-0 bg-transparent p-0 text-[15px] leading-[1.5] text-[#0b1024] shadow-none outline-none placeholder:text-[#9b9fb3] focus-visible:border-0 focus-visible:ring-0 disabled:opacity-60 md:text-[15px] touch:min-h-0";

/** Textarea внутри рамки (периодичность контроля, примечания). */
export const JOURNAL_DIALOG_FIELD_TEXTAREA_CLASS =
  "min-h-[68px] w-full resize-none rounded-none border-0 bg-transparent p-0 text-[15px] leading-[1.45] text-[#0b1024] shadow-none outline-none placeholder:text-[#9b9fb3] focus-visible:border-0 focus-visible:ring-0 md:text-[15px]";

/**
 * SelectTrigger внутри рамки. `w-full` вместо дефолтного `w-fit` —
 * именно `w-fit` схлопывал «Должность ответственного за уборку» в пустую
 * пилюлю ~50px, когда предзаполненного значения не было в списке опций.
 */
export const JOURNAL_DIALOG_FIELD_TRIGGER_CLASS =
  "h-7 w-full justify-between rounded-none border-0 bg-transparent p-0 text-[15px] text-[#0b1024] shadow-none focus-visible:ring-0 data-[size=default]:h-7 data-[size=sm]:h-7 data-[placeholder]:text-[#9b9fb3] [&>span]:truncate touch:min-h-0";

/** Заметный (amber) хинт под полем — «сотрудников на должности нет». */
export const JOURNAL_DIALOG_HINT_CLASS =
  "mt-2 rounded-xl border border-[#f2d9a0] bg-[#fff8e8] px-3.5 py-2.5 text-[12.5px] leading-[1.4] text-[#8a6212]";

/** Текст ошибки под полем — как «Поле не заполнено» на эталоне. */
export const JOURNAL_DIALOG_ERROR_CLASS =
  "mt-1.5 text-[12.5px] leading-[1.35] text-[#e5484d]";

/** Единственная кнопка действия справа внизу («Создать» / «Сохранить»). */
export const JOURNAL_DIALOG_SUBMIT_CLASS =
  "h-10 rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/** Ряд с кнопкой действия: всегда справа, всегда одна кнопка. */
export const JOURNAL_DIALOG_ACTIONS_CLASS = "flex justify-end pt-1";

/** Вертикальный ритм колонки полей внутри диалога. */
export const JOURNAL_DIALOG_FIELDS_CLASS = "space-y-4";

export const JOURNAL_DIALOG_GRID_CLASS = "grid gap-4 sm:gap-5 md:grid-cols-2";

/** Ширина контента — во всю ширину экрана, потолок 1800px (R1). */
export const REGISTER_DOCUMENT_PAGE_CLASS =
  "mx-auto max-w-[1800px] px-4 py-2 sm:px-6 sm:py-3 lg:px-8";

export const REGISTER_DOCUMENT_HEADER_CLASS =
  "mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5";

export const REGISTER_DOCUMENT_ACTIONS_CLASS =
  "flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3";

export const REGISTER_DOCUMENT_SUMMARY_CLASS =
  "mb-5 rounded-[16px] bg-[#f3f4fe] px-4 py-3 sm:px-5 sm:py-3.5";

export const REGISTER_DOCUMENT_SUMMARY_ROW_CLASS =
  "flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4";

export const REGISTER_DOCUMENT_SUMMARY_STATS_CLASS =
  "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4";

/* ------------------------------------------------------------------ *
 * Канонический вертикальный ритм страницы документа
 * ------------------------------------------------------------------ *
 *
 * Замерен по эталону lk.haccp-online.ru
 * (docs/reference/haccp-online/screenshots/cleaning-04-grid.png,
 *  cleaning-07-grid-with-room.png, fryer_oil-grid.png).
 *
 * Порядок блоков на странице документа — один для всех 13 обязательных
 * журналов:
 *
 *   1. хлебные крошки            (рендерятся страницей, не клиентом)
 *   2. H1 слева + «Настройки журнала» / «⋯» справа  → DOC_TITLE_ROW_CLASS
 *   3. полоса «Автоматически заполнять журнал»      → DOC_AUTOFILL_STRIP_CLASS
 *   4. бумажная ХАССП-шапка                          → DOC_PAPER_HEADER_CLASS
 *   5. центрированный КАПС-заголовок                 → DOC_CAPS_TITLE_CLASS
 *   6. «Добавить» + доп. тулбары слева над таблицей  → DOC_ADD_ROW_CLASS
 *   7. основная таблица
 *   8. «Условные обозначения»                        → DOC_LEGEND_CLASS
 *   9. дополнительные таблицы / приложения           → DOC_EXTRA_BLOCK_CLASS
 *
 * Ритм эталона: крошки→H1 12, H1→полоса 20, полоса→шапка 40,
 * шапка→капс 28, капс→«Добавить» 20, «Добавить»→таблица 12,
 * таблица→легенда 24, легенда→вторая таблица 32.
 *
 * ВАЖНО: держим ритм в этих трёх-четырёх константах, а не голыми
 * числами в 13 файлах — иначе разнобой возвращается на следующей правке.
 */

/**
 * Корневая обёртка тела документа. Ритм задают сами блоки (mb-*),
 * поэтому общего `space-y-*` тут намеренно нет: blanket-отступ
 * перебивал бы канон.
 */
export const DOC_BODY_STACK_CLASS = "print:space-y-0";

/** H1 страницы документа — та же типографика, что у H1 списка (32px/700). */
export const DOC_HEADING_CLASS =
  "text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]";

/**
 * Строка заголовка: H1 слева, действия справа. 20px до следующего блока.
 *
 * На узком экране строка ЛОМАЕТСЯ НА ДВЕ: заголовок сверху, действия под
 * ним. Пока это был один flex-ряд, кнопки («Печать», «Настройки журнала»,
 * «⋯») занимали свои ~250px и не ужимались, а заголовку доставалось
 * несколько десятков пикселей — длинное название вроде «Журнал учёта
 * использования фритюрных жиров» рассыпалось по одной букве в строку.
 */
export const DOC_TITLE_ROW_CLASS =
  "mb-5 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4 print:hidden";

/**
 * Override-отступ строки заголовка для журналов БЕЗ полосы автозаполнения
 * (бракераж, скоропорт, медкнижки, фритюр, журнал здоровья, санитарный
 * день, любой закрытый документ) — Q3 аудита.
 *
 * Там, где полоса есть, ритм «H1 → полоса 20px → шапка 40px» держат
 * DOC_TITLE_ROW_CLASS и DOC_AUTOFILL_STRIP_CLASS. Там, где полосы нет,
 * H1 упирается прямо в бумажную шапку, и эталонный зазор — 28px. Раньше
 * каждый такой журнал добирал его своей обёрткой с `py-*`: получалось
 * 28/49/52/81. Передаётся в `className` <DocumentActionsBar>, где
 * `cn()` (tailwind-merge) снимает конфликт с `mb-5`.
 */
export const DOC_TITLE_ROW_NO_STRIP_CLASS = "mb-7";

/**
 * Полоса автозаполнения — Q3 аудита.
 *
 * Эталон рисует её ОДИНАКОВО во всех 13 журналах: ЛЕНТА во всю ширину
 * контентной колонки, высота 48px, БЕЗ скругления, фон #f3f4fe,
 * штатный тумблер 44×24, зазор тумблер→подпись 12px (gap-3), подпись
 * 15px/600. Ритм: H1 → полоса 20px (`mb-5` у DOC_TITLE_ROW_CLASS),
 * полоса → бумажная шапка 40px (`mb-10` здесь).
 *
 * Геометрия ленты — та же, что у DOC_FILTER_STRIP_CLASS: `-mx-4 md:-mx-8`
 * вычитает горизонтальный padding контейнера страницы, `px-*` возвращает
 * его контенту — заливка идёт от края до края карточки, а тумблер стоит
 * на левой линии документа.
 *
 * Высота: 24px (тумблер) + 12px×2 паддинга = 48px. `min-h-[48px]`
 * фиксирует её и когда в полосе нет тумблера.
 *
 * Токен САМ является flex-строкой: до Q3 каждый журнал заводил свою
 * внутреннюю обёртку с собственным gap (4/3/4) и своим фоном/радиусом
 * (r32+p-8 у cold_equipment, r28 у вентиляции, r24 у климата) — полоса
 * выглядела по-разному на каждой странице.
 */
export const DOC_AUTOFILL_STRIP_CLASS =
  "-mx-4 mb-10 flex min-h-[48px] items-center gap-3 bg-[#f3f4fe] px-4 py-3 print:hidden md:-mx-8 md:px-8";

/**
 * Подпись рядом с тумблером автозаполнения (P8).
 *
 * До этой правки каждый журнал писал свой размер: 14/400, 14/600, 16/600,
 * 18/600, 20/500, 22/500 — полоса выглядела по-разному на каждой странице.
 * Эталон держит 15px/600. Держим ОДИН токен, а не восемь хардкодов.
 */
export const DOC_AUTOFILL_LABEL_CLASS =
  "text-[15px] font-semibold leading-tight text-black";

/**
 * Полоса фильтра/сортировки НАД бумажной шапкой — вариант эталона
 * lk.haccp-online.ru (incoming_control-grid.png): не скруглённая карточка
 * с отступами, а лента во всю ширину карточки документа.
 *
 * `-mx-4 md:-mx-8` вычитает горизонтальный padding контейнера страницы
 * (`journals/[code]/layout.tsx`), `px-*` возвращает его контенту — поэтому
 * заливка идёт от края до края, а текст остаётся на левой линии документа.
 */
export const DOC_FILTER_STRIP_CLASS =
  "-mx-4 mb-10 bg-[#f3f4fe] px-4 py-3.5 print:hidden md:-mx-8 md:px-8 md:py-4";

/**
 * «Бумажное полотно» документа — S8 аудита, пересмотрено в R1.
 *
 * Бланк (шапка ХАССП → КАПС-титул → «Добавить» → таблица →
 * пояснения/легенда) идёт ВО ВСЮ ширину контентной колонки: своей
 * `max-w` у полотна больше нет. Раньше стояло `max-w-[1150px]` —
 * владелец назвал это «узко», бумажная зона висела островом посреди
 * широкой страницы, а её левая линия не совпадала с крошками и H1.
 *
 * Теперь горизонтальную геометрию задаёт РОВНО один контейнер —
 * `journals/[code]/layout.tsx` (max-w-[1800px] + px-4 md:px-8), а полотно
 * лишь наследует его ширину. Таблицы шире экрана (cold_equipment на
 * 15 дней, приёмка на 11 колонок, уборка на 1200) продолжают скроллиться
 * ВНУТРИ своего `GRID_VIEWPORT_CLASS`, который лежит внутри полотна.
 *
 * `print:max-w-none` оставлен намеренно: на бумаге лист задаёт `@page`,
 * и токен не должен зависеть от того, вернётся ли когда-нибудь `max-w`.
 */
export const DOC_PAPER_CANVAS_CLASS =
  // Своего горизонтального скролла у полотна нет: на мобильном вбок едет
  // вся страница документа целиком (см. layout страницы документа), и
  // вложенный скроллер превращал бы её в узкое окошко внутри отступов.
  "mx-auto w-full print:max-w-none";

/**
 * Бумажная ХАССП-шапка в карточном виде на телефоне.
 *
 * Шапка живёт в одном горизонтальном скроллере с таблицей и потому
 * имеет её минимальную ширину (у климата — 1280px). В карточном виде
 * таблица скрыта, а шапка оставалась и уезжала за правый край: человек
 * видел обрезанный бланк и не понимал, что это. Канон
 * `JournalDocumentShell` — в карточках бумага скрыта целиком; здесь
 * прячем только шапку, чтобы «Добавить строку» осталась на месте.
 * На печати шапка возвращается.
 */
export const DOC_PAPER_HEADER_CARDS_HIDDEN_CLASS =
  "hidden sm:block print:block";

/**
 * Пояснительные тексты под таблицей (S9/Z2 аудита): «В журнал
 * регистрируются…», абзацы журнала здоровья, примечания и легенды.
 *
 * У эталона это мелкий бумажный кегль 12-13px с интерлиньяжем ~1.4;
 * у нас стояло 16px/28px, из-за чего блоки выходили в 1.5-2 раза выше.
 */
export const DOC_NOTE_TEXT_CLASS = "text-[12.5px] leading-[1.4]";

/* ------------------------------------------------------------------ *
 * ЕДИНЫЙ БЛАНК (R1)
 * ------------------------------------------------------------------ *
 *
 * Требование владельца: «все журналы визуально должны быть как единый
 * бланк, не раздельная шапка сверху». До R1 внутри бумажной зоны стояли
 * зазоры 28px (шапка → титул) и 20px (титул → «Добавить»), из-за чего
 * ХАССП-шапка читалась отдельной карточкой, а не первым блоком листа.
 *
 * Теперь шапка, КАПС-титул, ряд «Добавить» и основная таблица идут
 * ПЛОТНО: рамка шапки упирается в титул, титул — компактная строка
 * 8px сверху/снизу, ряд кнопок — такая же компактная строка py-2.
 * Ширина у шапки и таблицы одна (обе `w-full` внутри одного
 * `DOC_PAPER_CANVAS_CLASS`), поэтому внешние вертикальные линии
 * совпадают по x и лист читается сплошным.
 */

/**
 * Бумажная ХАССП-шапка. Нижнего зазора НЕТ — она примыкает к титулу
 * и таблице, это верхняя часть того же листа (R1). Токен намеренно
 * не пустая строка: часть журналов клеит его через шаблонную строку
 * без `cn()`, и явный `mb-0` перебивает возможный внешний отступ.
 */
export const DOC_PAPER_HEADER_CLASS = "mb-0";

/**
 * Центрированный КАПС-заголовок документа — компактная строка ВНУТРИ
 * листа: 8px сверху и снизу (R1), было `mb-5` без верхнего отступа.
 */
export const DOC_CAPS_TITLE_CLASS = "my-2";

/**
 * ВТОРИЧНАЯ кнопка ряда «Добавить» — Q3 аудита.
 *
 * «Редактировать список(и)», «Добавить исследование» и прочие спутники
 * главной кнопки жили пятью разными спецификациями: высоты 44/40/36/36,
 * три фона (#f5f6ff, #5566f6/0.04, #5566f6/0.06), три кегля (15/14/13.5)
 * и два радиуса. Ряд «Добавить» держит ОДНУ высоту 44px, поэтому
 * вторичная кнопка — тот же `h-11`, что и первичная, только светлая.
 */
/**
 * Первичная кнопка «Добавить» над таблицей — эталон уборки и гигиены
 * (`StaffJournalAddButton`): 44px, скругление lg, индиго-заливка.
 *
 * До единой раскладки каждый журнал держал свою: h-10 rounded-xl 13.5px,
 * h-12 rounded-2xl 16px, h-[58px] rounded-2xl 18px. В одном и том же
 * месте экрана кнопка меняла размер от журнала к журналу.
 */
export const DOC_PRIMARY_BUTTON_CLASS =
  "h-11 w-fit gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white hover:bg-[#4a5bf0]";

export const DOC_SECONDARY_BUTTON_CLASS =
  "inline-flex h-11 items-center gap-2 rounded-lg border-0 bg-[#f5f6ff] px-5 text-[15px] font-semibold text-[#5566f6] shadow-none transition-colors duration-150 hover:bg-[#eef0ff]";

/**
 * Строка «Добавить» и доп. тулбаров слева над таблицей.
 *
 * R1: `mb-3` заменён на собственный `py-2` — кнопки остаются на месте
 * функционально, но больше не разрывают лист пустым полем: это такая же
 * компактная строка листа, как КАПС-титул. `print:hidden` сохранён.
 */
export const DOC_ADD_ROW_CLASS =
  "flex flex-wrap items-center gap-3 py-2 print:hidden";

/** «Условные обозначения» под таблицей. 24px сверху. */
export const DOC_LEGEND_CLASS = "mt-6";

/** Дополнительные таблицы и приложения под легендой. 32px сверху. */
export const DOC_EXTRA_BLOCK_CLASS = "mt-8";

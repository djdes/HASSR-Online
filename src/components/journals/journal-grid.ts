import { JOURNAL_TABLE_VIEWPORT_CLASS } from "@/components/journals/journal-responsive";
import { getCalendarDayKind } from "@/lib/production-calendar-data";

/**
 * Единые токены «бумажной» сетки журнала.
 *
 * Раньше эти четыре константы дублировались локально в каждом
 * `*-document-client.tsx` (13+ копий), поэтому компактность таблиц
 * приходилось править построчно. Теперь размер/цвет меняется в одном месте.
 *
 * Screen ↔ print duality: НА ЭКРАНЕ — мягкие границы `#ececf4`,
 * серо-голубая шапка, скруглённый viewport. ПРИ ПЕЧАТИ инспектор РПН/СЭС
 * ждёт «бумагу» — чёрные рамки без заливок, поэтому каждый токен несёт
 * пару screen + `print:`. Print-часть трогать нельзя.
 */

/**
 * Цвет «бумажной» границы НА ЭКРАНЕ.
 *
 * Эталон (lk.haccp-online.ru) рисует таблицы документов как печатную форму —
 * сплошная тёмная линия 1px, а не бледно-серая рамка карточки. Раньше у нас
 * стоял `#ececf4`, из-за чего документ на экране читался как «таблица в
 * интерфейсе», а не как бланк.
 *
 * Держим ОДИН токен: цвет меняется здесь, а не в 13 клиентах. Печатная часть
 * (`print:border-black`) не трогается — бумага для РПН/СЭС остаётся чёрной.
 */
export const GRID_BORDER_COLOR = "#333";

/** Только цвет границы — для мест, где рамка задаётся частично (border-r и т.п.). */
export const GRID_BORDER_CLASS = "border-[#333] print:border-black";

export const GRID_CELL_CLASS = "border border-[#333] print:border-black";

export const GRID_HEAD_CELL_CLASS =
  "border border-[#333] bg-[#f1f2f6] print:border-black print:bg-white";

export const GRID_HEAD_CELL_PLAIN_CLASS =
  "border border-[#333] bg-white print:border-black";

/**
 * Всегда ВИДИМЫЙ горизонтальный скроллбар внутри viewport'а (M3 аудита).
 *
 * `GRID_VIEWPORT_CLASS` и так даёт `overflow-x-auto`, но на macOS и в
 * Chromium с overlay-скроллбарами полоса появляется только во время
 * прокрутки: широкая таблица (медкнижки — 10+ колонок осмотров и столько
 * же прививок) выглядит просто ОБРЕЗАННОЙ справа, и пользователь не
 * догадывается, что «Маммография» и последние прививки доступны скроллом.
 *
 * Токен рисует тонкую постоянную полосу и в печать не идёт.
 *
 * Полоса должна быть видна ДАЖЕ КОГДА НИКТО НЕ СКРОЛЛИТ, поэтому у трека
 * есть собственная заливка `#f1f2f6` (прозрачный трек прошлой версии
 * визуально исчезал: на скриншотах прода полосы не было вовсе).
 * Токен вклеен прямо в `GRID_VIEWPORT_CLASS` — иначе его приходилось
 * помнить в каждом из 14 клиентов, и половина широких таблиц (перечень,
 * климат, холодильники, уборка, приёмка) оставалась без него.
 */
export const GRID_VIEWPORT_SCROLLBAR_CLASS =
  "[scrollbar-width:thin] [scrollbar-color:#c9cddd_#f1f2f6] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-[#f1f2f6] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#c9cddd] [&::-webkit-scrollbar-thumb:hover]:bg-[#a7adcd] print:[scrollbar-width:none] print:[&::-webkit-scrollbar]:hidden";

/** Скруглённый viewport вокруг таблицы; в печати — прозрачный wrapper. */
export const GRID_VIEWPORT_CLASS = `${JOURNAL_TABLE_VIEWPORT_CLASS} ${GRID_VIEWPORT_SCROLLBAR_CLASS} print:mx-0 print:overflow-visible print:rounded-none print:border-0 print:bg-transparent print:px-0 print:shadow-none`;

/**
 * Вариант viewport'а для «широких» журналов (hygiene / health_check), где
 * на десктопе таблица помещается целиком и горизонтальный скролл не нужен.
 */
export const GRID_VIEWPORT_WIDE_CLASS = `${JOURNAL_TABLE_VIEWPORT_CLASS} ${GRID_VIEWPORT_SCROLLBAR_CLASS} lg:overflow-visible print:mx-0 print:overflow-visible print:rounded-none print:border-0 print:bg-transparent print:px-0 print:shadow-none`;

/**
 * Заливка КОЛОНКИ ДНЯ по производственному календарю РФ (H4 аудита):
 * весь столбец нерабочего дня закрашен — так проверяющий сразу видит,
 * почему в этот день пусто.
 *
 * Механика ровно та же, что в `cleaning-document-client.tsx`
 * (`getCalendarDayKind` → выходной / сокращённый), просто вынесена в общий
 * токен, чтобы hygiene / health_check не заводили свою копию.
 *
 * Цвет — ТОЛЬКО серый (2026-09-27, владелец: «у всех чёрно-белые
 * принтеры»). Прежние розовый #f8d7d4 и бежевый #fdeeda на ч/б листе
 * выходили почти одинаково бледными. Серые разной светлоты различимы и на
 * ч/б печати: выходной/праздник — #d4d4d4, сокращённый — #ebebeb. Те же
 * значения печатает PDF (`PDF_DAY_OFF_FILL` / `PDF_DAY_SHORT_FILL` в
 * `document-pdf.ts`, сверяет `print-colors.test.ts`); тёмная тема и печать
 * из тёмной темы — `app-theme.css` («КАЛЕНДАРНЫЕ ДНИ В СЕТКЕ»).
 *
 * A18 аудита: заливка ПЕЧАТАЕТСЯ. Раньше здесь стоял
 * `print:bg-transparent`, и на бумаге проверяющий видел просто пустые
 * строки без объяснения — «журнал не заполняли». Серый столбец
 * выходного и есть объяснение, поэтому он идёт на печать.
 *
 * Механика опт-аута: тотальный светлый сброс печати
 * (`app-theme.css`, `.app-shell *:not([data-print-keep-bg])`) и правило
 * `th/td { background: white }` в `globals.css` пропускают элементы с
 * атрибутом `data-print-keep-bg`. Поэтому одного класса мало — ячейка
 * дня обязана нести и атрибут, см. `getDayColumnPrintKeepBg()`.
 */
export const GRID_DAY_OFF_BG_CLASS = "bg-[#d4d4d4]";
export const GRID_DAY_SHORT_BG_CLASS = "bg-[#ebebeb]";

export function getDayColumnBgClass(dateKey: string): string {
  const kind = getCalendarDayKind(dateKey).kind;
  if (kind === "holiday" || kind === "weekend") return GRID_DAY_OFF_BG_CLASS;
  if (kind === "short") return GRID_DAY_SHORT_BG_CLASS;
  return "";
}

/**
 * Значение атрибута `data-print-keep-bg` для ячейки колонки дня.
 *
 * Возвращает `""` (атрибут присутствует) для нерабочих/сокращённых дней
 * и `undefined` (атрибута нет) для обычных — так React вообще не
 * выводит атрибут, и обычная ячейка остаётся под общим белым сбросом.
 *
 * Использовать В ПАРЕ с `getDayColumnBgClass()`:
 *   className={`… ${getDayColumnBgClass(dateKey)}`}
 *   data-print-keep-bg={getDayColumnPrintKeepBg(dateKey)}
 */
export function getDayColumnPrintKeepBg(dateKey: string): "" | undefined {
  return getDayColumnBgClass(dateKey) ? "" : undefined;
}

export const CELL_FOCUS_CLASS =
  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 focus-visible:relative focus-visible:z-10";

/**
 * Компактная типографика таблицы — эталон (lk.haccp-online.ru) держит
 * сетку заметно мельче нашей прежней. Клиенты используют эти токены там,
 * где раньше стояли хардкод `text-[14px] p-3`.
 */
export const GRID_TEXT_CLASS = "text-[13px]";

/**
 * Вертикальный ритм строк. Эталон (lk.haccp-online.ru) держит строку данных
 * в ~34-38px: `text-[13px]` × `leading-tight` (≈18px) + 2×4px паддинга +
 * рамки. Наш прежний `py-1.5` без `leading-tight` давал ~44-48px, и владелец
 * справедливо называл таблицы «массивными».
 *
 * Данные — `py-1`, шапка — `py-1.5` (заголовки часто в две строки, им нужен
 * воздух). `print:` не трогаем: печатная сетка задаётся отдельными
 * `@media print` правилами внутри клиентов.
 */
export const GRID_CELL_PAD_CLASS = "px-2 py-1 leading-tight";
export const GRID_HEAD_PAD_CLASS = "px-2 py-1.5 leading-tight";

/**
 * Высота интерактивной ячейки-кнопки (уборка, гигиена): достаточно, чтобы
 * попасть пальцем, но не выше строки данных соседних журналов.
 */
export const GRID_CELL_BUTTON_CLASS = "h-8 min-h-8";

/**
 * Кнопка-ячейка внутри «бумажной» таблицы («+ Добавить помещение»,
 * «+ Добавить частоту контроля», «+ Добавить»). На эталоне
 * (lk.haccp-online.ru) это широкая ячейка во всю ширину своей колонки,
 * а не мелкая ссылка сбоку — попасть по ней можно не целясь.
 *
 * Токены: заливка `#eef0ff`, текст `#5566f6` (см. фазу N5,
 * `cleaning-ventilation-checklist-document-client.tsx`, где приём
 * появился первым). Никогда не печатается — на бумаге кнопок нет.
 */
export const GRID_ADD_CELL_CLASS =
  "flex w-full items-center justify-center gap-2 bg-[#eef0ff] px-4 py-2 text-[13.5px] font-semibold text-[#5566f6] transition-colors duration-150 hover:bg-[#e2e6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 print:hidden";

/**
 * Тот же приём, но СПЛОШНОЙ синей заливкой во всю ширину ячейки —
 * ровно как на эталоне climate_control-grid.png («+ Добавить помещение»,
 * «+ Добавить частоту контроля»): индиго-плашка с белым текстом, а не
 * светло-лавандовая ссылка.
 */
export const GRID_ADD_CELL_SOLID_CLASS =
  "flex w-full items-center justify-center gap-2 bg-[#5566f6] px-4 py-2.5 text-[13.5px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 print:hidden";

/**
 * Оранжевая служебная метка внутри таблицы («Ответственный за снятие
 * показателей»). Эталон выделяет её именно цветом текста, без заливки —
 * это подпись к строке, а не заголовок колонки. В печати остаётся
 * читаемой (оранжевый превращается в чёрный правилом `print:text-black`).
 */
export const GRID_SERVICE_LABEL_CLASS =
  "text-[12px] font-semibold leading-tight text-[#e07b00] print:text-black";

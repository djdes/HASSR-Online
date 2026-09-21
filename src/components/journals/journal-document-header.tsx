/**
 * Официальный ХАССП-style документ-заголовок.
 *
 * Используется в верхней части каждого journal-document-client'а.
 * Воспроизводит вид бумажного журнала — три колонки:
 *
 *   ┌────────────┬────────────────────────────────┬─────────────┐
 *   │            │       СИСТЕМА ХАССП            │             │
 *   │  ООО {имя} ├────────────────────────────────┤  СТР 1 ИЗ 1 │
 *   │            │  {Название журнала, italic}    │             │
 *   └────────────┴────────────────────────────────┴─────────────┘
 *
 * Делает наши журналы похожими на «бумажные» при печати —
 * РПН/СЭС-проверка ожидает официального ХАССП-блока сверху.
 *
 * Аналог haccp-online.ru, но в нашей design-system.
 */

import {
  GRID_CELL_CLASS,
  GRID_HEAD_CELL_CLASS,
} from "@/components/journals/journal-grid";
import {
  HeaderOrgName,
  HeaderPeriodicity,
  HeaderTitle,
} from "@/components/journals/journal-header-edit";

type Props = {
  /** Название организации (ООО «Кухня» / ИП Иванов и т.п.). */
  orgName: string;
  /** Полное название журнала, italic в нижней средней ячейке. */
  title: string;
  /** Текст в правой нижней ячейке. По умолчанию «СТР. 1 ИЗ 1». */
  pageInfo?: string;
  /** Дата начала документа (`JournalDocument.dateFrom`). */
  startedAt?: Date | string | null;
  /**
   * Дата закрытия документа. У активного документа — `null`: в правой
   * верхней ячейке печатается подчёркнутый пропуск, как на бумаге.
   */
  finishedAt?: Date | string | null;
  /**
   * Устаревшая форма тех же двух дат. Оставлена ради вызовов, которые
   * ещё передают `dateMode={{ startedAt, finishedAt }}`.
   */
  dateMode?: {
    startedAt?: Date | string | null;
    finishedAt?: Date | string | null;
  };
  /**
   * «Периодичность контроля» — отдельная строка шапки (осознанное решение
   * владельца, у эталона её нет). Значение приходит из
   * `JournalDocument.config.controlPeriodicity`
   * (см. `src/lib/control-periodicity.ts`). Пустая строка / undefined —
   * строка не рендерится.
   */
  controlPeriodicity?: string | null;
  /** Доп. css-класс для wrapper. */
  className?: string;
};

/**
 * Дата в формате эталона — `ДД-ММ-ГГГГ` (climate_control-grid.png:
 * «Начат 10-08-2026»). Пусто/битая дата — подчёркнутый пропуск.
 */
export const PAPER_HEADER_DATE_BLANK = "__________";

export function formatPaperHeaderDate(
  d: Date | string | null | undefined
): string {
  if (!d) return PAPER_HEADER_DATE_BLANK;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return PAPER_HEADER_DATE_BLANK;
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${dt.getFullYear()}`;
}

/**
 * Строки бумажной шапки как `<tr>` — вставляются прямо в `<tbody>` таблицы
 * журнала, поэтому шапка ВСЕГДА ровно той же ширины, что и сама таблица
 * (раньше в cleaning шапка была ~57% ширины сетки и центрировалась отдельно).
 *
 * Раскладка — как на эталоне (climate_control-grid.png):
 *
 *   ┌──────────────┬──────────────────────────┬──────────────────────┐
 *   │              │      СИСТЕМА ХАССП       │ Начат    10-08-2026  │
 *   │  ООО «Имя»   │                          │ Окончен  __________  │
 *   │              ├──────────────────────────┼──────────────────────┤
 *   │              │  {название журнала}      │     СТР. 1 ИЗ 1      │
 *   ├──────────────┴──────────────────────────┴──────────────────────┤
 *   │ Периодичность контроля │ {текст}                               │
 *   └────────────────────────┴───────────────────────────────────────┘
 *
 * Все ячейки — с видимыми границами (`GRID_CELL_CLASS`), включая правую
 * колонку: до этой правки она «висела» без рамки.
 */
export function JournalPaperHeaderRows({
  orgName,
  title,
  pageInfo = "СТР. 1 ИЗ 1",
  startedAt,
  finishedAt,
  controlPeriodicity,
  orgCellClass = "w-[20%]",
  sideCellClass = "w-[22%]",
}: {
  orgName: string;
  title: string;
  pageInfo?: string;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  controlPeriodicity?: string | null;
  /** Ширина левой колонки (у широких сеток задаётся в px). */
  orgCellClass?: string;
  /** Ширина правой колонки. */
  sideCellClass?: string;
}) {
  return (
    <>
      <tr>
        <td
          rowSpan={2}
          className={`group/header-org ${orgCellClass} ${GRID_CELL_CLASS} px-3 py-2 text-center text-[13px] font-semibold leading-tight`}
        >
          {/* Карандаш правки — только на странице документа (контекст), в печать не идёт. */}
          <HeaderOrgName orgName={orgName} />
        </td>
        <td
          className={`${GRID_CELL_CLASS} px-3 py-2 text-center text-[13px] uppercase leading-tight`}
        >
          СИСТЕМА ХАССП
        </td>
        <td
          className={`${sideCellClass} ${GRID_CELL_CLASS} px-3 py-2 text-[13px] leading-tight`}
        >
          {/* `flex-wrap`: на узком телефоне дата уходит на вторую строку,
              а не выталкивает шапку за правый край (там «Начат…/Окончен…»
              обрезались и не читались). */}
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">Начат</span>
            <span className="tabular-nums">{formatPaperHeaderDate(startedAt)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span>Окончен</span>
            <span className="tabular-nums">{formatPaperHeaderDate(finishedAt)}</span>
          </div>
        </td>
      </tr>
      <tr>
        <td
          className={`group/header-title ${GRID_CELL_CLASS} px-3 py-2 text-center text-[13px] uppercase italic leading-tight`}
        >
          <HeaderTitle title={title} />
        </td>
        {/*
          S11 аудита: «СТР. 1 ИЗ 1» читалось как «СТР. 1ИЗ 1» — цифра «1»
          в Manrope имеет узкие боковые полуапроши, и обычный пробел между
          «1» и «ИЗ» визуально схлопывался. Пробелы не режутся ни tracking,
          ни whitespace-правилами — им просто не хватает ширины, поэтому
          ячейке добавлен word-spacing и запрет переноса.
        */}
        {/*
          R5-10: «СТР. 1 ИЗ 1» ВРАЛО на бумаге. Реальное число листов
          браузерной печати зависит от драйвера, полей и масштаба —
          CSS его не знает и знать не может, а `@page` счётчиков в
          Chrome нет. Печатать заведомо ложное «1 ИЗ 1» в официальном
          ХАССП-бланке хуже, чем не печатать ничего: инспектор РПН
          сверяет нумерацию.

          Поэтому у ячейки ДВА варианта: на экране и в серверном PDF
          (`document-pdf.ts` рисует шапку сам и сюда не заходит)
          остаётся прежний `pageInfo`, а в браузерной печати выводится
          бумажный пропуск «СТР. ___ ИЗ ___» под ручное заполнение —
          ровно как в типографских бланках.

          Повтор шапки на КАЖДОМ листе не делаем: для этого шапка
          должна жить в `<thead>` таблицы данных, а она у нас — строки
          общего `<tbody>` бланка (единая рамка, см. R1).
        */}
        <td
          className={`${GRID_CELL_CLASS} px-3 py-2 text-center text-[13px] uppercase leading-tight [word-spacing:0.18em] sm:whitespace-nowrap`}
        >
          <span className="print:hidden">{pageInfo}</span>
          <span className="hidden print:inline">СТР. ___ ИЗ ___</span>
        </td>
      </tr>
      <JournalPeriodicityHeaderRow
        text={controlPeriodicity}
        labelClass={GRID_HEAD_CELL_CLASS}
        valueClass={GRID_CELL_CLASS}
        valueColSpan={2}
      />
    </>
  );
}

/**
 * Готовая бумажная шапка отдельной таблицей — для журналов, у которых
 * сетка данных живёт в своей `<table>`. Ширина — 100% контейнера, то есть
 * ровно ширина журнальной таблицы, если обе лежат в одном viewport'е.
 */
export function JournalDocumentHeader({
  orgName,
  title,
  pageInfo = "СТР. 1 ИЗ 1",
  startedAt,
  finishedAt,
  dateMode,
  controlPeriodicity,
  className = "",
}: Props) {
  // Свой `overflow-x-auto`: если на узком телефоне шапка всё-таки шире
  // экрана (длинное название организации), её можно прокрутить, а не
  // потерять правый край с «Начат/Окончен» и «СТР. 1 ИЗ 1». Раньше
  // шапка med_books / uv_lamp_runtime обрезалась на 66–98px.
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table
        className={`w-full border-collapse text-[13px] text-[#0b1024] ${className}`}
      >
        <tbody>
          <JournalPaperHeaderRows
            orgName={orgName}
            title={title}
            pageInfo={pageInfo}
            startedAt={startedAt ?? dateMode?.startedAt}
            finishedAt={finishedAt ?? dateMode?.finishedAt}
            controlPeriodicity={controlPeriodicity}
          />
        </tbody>
      </table>
    </div>
  );
}

/**
 * Та же строка «Периодичность контроля», но как `<tr>` — для журналов,
 * чья бумажная шапка собрана собственной `<table>` (гигиена, здоровье,
 * климат, бракераж, приёмка, вентиляция, генеральные уборки).
 *
 * `labelClass` / `valueClass` принимают GRID-токены хоста
 * (`GRID_CELL_CLASS` и т.п.), поэтому строка наследует и экранный стиль,
 * и `print:border-black`.
 */
export function JournalPeriodicityHeaderRow({
  text,
  labelClass = "",
  valueClass = "",
  valueColSpan = 2,
}: {
  text?: string | null;
  labelClass?: string;
  valueClass?: string;
  /** Сколько колонок занимает ячейка со значением (обычно «средняя + правая»). */
  valueColSpan?: number;
}) {
  const value = (text ?? "").trim();
  if (!value) return null;

  return (
    <tr>
      <td className={`px-3 py-2 text-center text-[12.5px] font-semibold ${labelClass}`}>
        Периодичность контроля
      </td>
      <td
        colSpan={valueColSpan}
        className={`group/header-periodicity px-3 py-2 text-[12.5px] leading-[1.4] ${valueClass}`}
      >
        <HeaderPeriodicity text={value} />
      </td>
    </tr>
  );
}

/**
 * Большой H2 заголовок журнала (рендерится сразу под document header'ом).
 * Имитирует «ЖУРНАЛ УБОРКИ» / «ГИГИЕНИЧЕСКИЙ ЖУРНАЛ» в haccp-online.
 */
export function JournalDocumentTitle({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`text-center text-[16px] font-semibold uppercase tracking-[0.04em] text-[#0b1024] sm:text-[18px] ${className}`}
    >
      {children}
    </h2>
  );
}

/**
 * Условные обозначения — italic underlined header + список сокращений.
 * Отрисовывается ПОД таблицей данных. РПН/СЭС-инспектор глядя в журнал
 * видит легенду что значит «Зд», «В», «Б/л», «T», «Г», «C1» и т.д.
 */
export function JournalLegendBlock({
  title = "Условные обозначения",
  items,
  className = "",
  variant = "card",
  autoPunctuation = true,
}: {
  title?: string;
  items: Array<{ symbol: string; description: string }>;
  className?: string;
  /**
   * `plain`-вариант по умолчанию сам дописывает «;» в конце каждой строки
   * кроме последней. У эталона гигиенического журнала пунктуация НЕ
   * регулярная («Зд. – здоров;», «В – … / отгул;», дальше без «;»),
   * поэтому такие журналы передают `autoPunctuation={false}` и держат
   * знаки прямо в тексте строки.
   */
  autoPunctuation?: boolean;
  /**
   * `card` — блок в белой карточке (журналы, где легенда стоит особняком).
   * `plain` — как на эталоне журнала уборки (cleaning-07-grid-with-room.png):
   * курсивный текст во всю ширину таблицы, подчёркнутый заголовок, без рамки
   * и скруглений — часть «бумаги», а не элемент интерфейса.
   */
  variant?: "card" | "plain";
}) {
  if (variant === "plain") {
    return (
      <div
        className={`w-full break-inside-avoid text-[12.5px] italic leading-[1.4] text-[#0b1024] sm:text-[13px] ${className}`}
      >
        <div className="mb-1 font-semibold underline underline-offset-2">
          {title}:
        </div>
        {items.map((item, idx) => (
          <div key={idx}>
            {item.symbol ? `${item.symbol} - ` : ""}
            {item.description}
            {autoPunctuation && idx !== items.length - 1 ? ";" : ""}
          </div>
        ))}
      </div>
    );
  }

  return (
    /*
     * R5-6: «Условные обозначения» НЕ РЕЖУТСЯ между листами.
     *
     * Симптом (гигиенический журнал): легенда разрывалась по середине
     * списка — часть сокращений («Зд», «В», «Б/л») оставалась на одном
     * листе, часть уезжала на следующий. Для проверяющего РПН легенда
     * без половины расшифровок бесполезна: она читается как единое
     * целое или не читается вообще.
     *
     * `break-inside-avoid` уводит блок ЦЕЛИКОМ на следующую страницу,
     * если он не помещается в остаток текущей. Свойство работает и на
     * экране (multi-column), но у нас легенда в одну колонку, поэтому
     * визуально это правило чисто печатное.
     */
    <div
      className={`mx-auto w-full max-w-[820px] break-inside-avoid rounded-2xl border border-[#ececf4] bg-white p-4 text-[12.5px] leading-relaxed text-[#3c4053] sm:p-5 sm:text-[13px] print:rounded-none print:border-black ${className}`}
    >
      <div className="mb-2 italic underline underline-offset-2 text-[12px] font-semibold sm:text-[12.5px]">
        {title}:
      </div>
      <ul className="space-y-1">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-baseline gap-2">
            <span className="font-semibold tabular-nums text-[#0b1024]">
              {item.symbol}
            </span>
            <span className="text-[#9b9fb3]">—</span>
            <span>{item.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

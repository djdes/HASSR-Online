"use client";

import type { ReactNode } from "react";

import {
  DocumentActionsBar,
  type DocumentBarMenuItem,
  type DocumentBarUndo,
} from "@/components/journals/document-actions-bar";
import { JournalClosedBanner } from "@/components/journals/journal-closed-banner";
import { useCanManageJournalDocument } from "@/components/journals/journal-header-edit";
import { JournalDocumentTitle } from "@/components/journals/journal-document-header";
import { MobileViewToggle } from "@/components/journals/mobile-view-toggle";
import { TodayProgressStrip } from "@/components/journals/today-progress-strip";
import type { MobileView } from "@/lib/use-mobile-view";
import {
  DOC_ADD_ROW_CLASS,
  DOC_AUTOFILL_LABEL_CLASS,
  DOC_AUTOFILL_STRIP_CLASS,
  DOC_CAPS_TITLE_CLASS,
  DOC_HEADING_CLASS,
  DOC_PAPER_CANVAS_CLASS,
  DOC_PAPER_HEADER_CLASS,
  DOC_TITLE_ROW_NO_STRIP_CLASS,
} from "@/components/journals/journal-responsive";
import { GRID_VIEWPORT_CLASS } from "@/components/journals/journal-grid";
import { Switch } from "@/components/ui/switch";
import { TOUR, type TourAnchor } from "@/lib/tour-anchors";

/**
 * Единая раскладка страницы документа — канон журналов «Уборка» и
 * «Гигиенический» (`docs/reference/haccp-online`, ритм описан в
 * `journal-responsive.ts`).
 *
 * До этого компонента канон существовал только в комментариях, и его
 * повторяли руками: 13 «обязательных» журналов собирали шапку через
 * `DocumentActionsBar`, ещё двадцать — своим `flex justify-between` с
 * H1 и кнопками, своей бумажной шапкой (`border-black p-3 text-[26px]`),
 * своим КАПС-заголовком 28px и своей обёрткой-карточкой
 * `rounded-[20px] border p-6`. На телефоне это давало три разных
 * раскладки одного и того же экрана.
 *
 * Порядок блоков (сверху вниз) — один для всех журналов:
 *
 *   1. H1 + период слева, «Печать» / «Настройки журнала» / «⋯» справа
 *   2. баннер «Журнал закрыт»
 *   3. полоса «Автоматически заполнять журнал»
 *   4. переключатель «Карточки / Таблица» (только телефон)
 *   5. карточки (телефон) ИЛИ бумажный лист:
 *        шапка ХАССП → КАПС-заголовок → «Добавить» → таблица
 *   6. легенда и приложения
 *
 * Лист живёт в ОДНОМ горизонтальном скроллере (`GRID_VIEWPORT_CLASS`),
 * поэтому бумажная шапка и таблица едут вбок вместе. `sheetMinWidth`
 * задаёт общую минимальную ширину: без неё шапка `w-full` расходилась
 * с широкой таблицей.
 */
export type JournalDocumentShellProps = {
  /** Заголовок страницы (H1). */
  title: ReactNode;
  /** Строка под заголовком: период документа, «Сохранение…». */
  subtitle?: ReactNode;
  /** Документ для серверного PDF в меню «⋯». */
  documentId?: string;
  backHref?: string;
  showPrint?: boolean;
  onSettings?: () => void;
  settingsLabel?: string;
  menuItems?: DocumentBarMenuItem[];
  undo?: DocumentBarUndo;
  /** Диалоги, которым нужен монтаж вне меню «⋯». */
  headerChildren?: ReactNode;

  /** Документ закрыт — показать баннер «только просмотр». */
  closed?: boolean;
  closedHint?: string;

  /** Полоса автозаполнения. Не передана — полосы нет (ритм 28px до листа). */
  autoFill?: {
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
    label?: string;
  };

  /**
   * Полоса «Сегодня осталось: N из M».
   *
   * Жила в четырёх журналах из тридцати пяти, хотя понятие «сегодня»
   * есть почти у всех. Слот в оболочке снимает необходимость копировать
   * её вёрстку в каждый клиент: журнал считает свои filled/total и
   * отдаёт сюда.
   */
  todayProgress?: {
    filled: number;
    total: number;
    label?: string;
    onJumpToToday?: () => void;
  };

  /** Блоки между шапкой и переключателем вида: фильтры, подсказки. */
  beforeToggle?: ReactNode;

  /** Режим отображения на телефоне. Не передан — переключателя нет. */
  mobileView?: MobileView;
  onMobileView?: (next: MobileView) => void;
  viewToggleTour?: TourAnchor;

  /**
   * Ряд «Добавить» и соседние кнопки. В табличном виде — над таблицей
   * внутри листа, в карточном — над карточками.
   */
  toolbar?: ReactNode;
  /** Карточки для телефона. */
  cards?: ReactNode;

  /** Бумажная шапка ХАССП (`JournalDocumentHeader` или своя таблица). */
  paperHeader?: ReactNode;
  /** КАПС-заголовок листа. */
  sheetTitle?: ReactNode;
  /** Общая минимальная ширина листа: шапка и таблица одной ширины. */
  sheetMinWidth?: number;
  /** Таблица документа. */
  children: ReactNode;
  /** Легенда, приложения, примечания — под таблицей. */
  extra?: ReactNode;
  className?: string;
};

export function JournalDocumentShell({
  title,
  subtitle,
  documentId,
  backHref,
  showPrint,
  onSettings,
  settingsLabel,
  menuItems,
  undo,
  headerChildren,
  closed = false,
  closedHint,
  autoFill,
  todayProgress,
  beforeToggle,
  mobileView,
  onMobileView,
  viewToggleTour,
  toolbar,
  cards,
  paperHeader,
  sheetTitle,
  sheetMinWidth,
  children,
  extra,
  className = "",
}: JournalDocumentShellProps) {
  const hasCards = Boolean(cards && mobileView && onMobileView);
  const cardsMode = hasCards && mobileView === "cards";
  // Полоса «Автоматически заполнять журнал» меняет настройку документа —
  // это право руководителя. Сотруднику её не показываем.
  const canManage = useCanManageJournalDocument();

  return (
    <div className={className}>
      <DocumentActionsBar
        backHref={backHref}
        documentId={documentId}
        showPrint={showPrint}
        heading={
          <div>
            <h1 className={DOC_HEADING_CLASS}>{title}</h1>
            {subtitle ? (
              <p className="mt-2 text-[15px] text-[#6f7282]">{subtitle}</p>
            ) : null}
          </div>
        }
        onSettings={onSettings}
        settingsLabel={settingsLabel}
        menuItems={menuItems}
        undo={undo}
        className={autoFill ? undefined : DOC_TITLE_ROW_NO_STRIP_CLASS}
      >
        {headerChildren}
      </DocumentActionsBar>

      {closed ? (
        <JournalClosedBanner hint={closedHint} className="mb-5 print:hidden" />
      ) : null}

      {autoFill && canManage ? (
        <section className={DOC_AUTOFILL_STRIP_CLASS}>
          <Switch
            checked={autoFill.checked}
            onCheckedChange={autoFill.onChange}
            disabled={autoFill.disabled}
            className="data-[state=unchecked]:bg-[#d4d8ec]"
          />
          <span className={DOC_AUTOFILL_LABEL_CLASS}>
            {autoFill.label ?? "Автоматически заполнять журнал"}
          </span>
        </section>
      ) : null}

      {todayProgress ? (
        <div className="mb-4 print:hidden">
          <TodayProgressStrip
            filled={todayProgress.filled}
            total={todayProgress.total}
            label={todayProgress.label}
            onJumpToToday={todayProgress.onJumpToToday}
          />
        </div>
      ) : null}

      {beforeToggle}

      {hasCards ? (
        <div className="mb-4 sm:hidden print:hidden">
          <MobileViewToggle
            mobileView={mobileView!}
            onChange={onMobileView!}
            dataTour={viewToggleTour ?? TOUR.viewToggle}
          />
        </div>
      ) : null}

      {cardsMode ? (
        <div className="mb-6 space-y-3 sm:hidden print:hidden">
          {toolbar}
          {cards}
        </div>
      ) : null}

      <div
        className={`${DOC_PAPER_CANVAS_CLASS} ${
          cardsMode ? "hidden sm:block print:block" : ""
        }`}
      >
        <div className={GRID_VIEWPORT_CLASS}>
          {/* `w-max` — ширину листа задаёт самая широкая таблица внутри.
              С `w-full` бумажная шапка вставала по ширине контейнера, а
              таблица распирала себя содержимым, и правая вертикаль
              бланка расходилась с колонками. */}
          <div
            className={sheetMinWidth ? "w-max" : "w-full"}
            style={
              sheetMinWidth
                ? { minWidth: `max(100%, ${sheetMinWidth}px)` }
                : undefined
            }
          >
            {paperHeader ? (
              <div className={DOC_PAPER_HEADER_CLASS}>{paperHeader}</div>
            ) : null}
            {sheetTitle ? (
              <div className={DOC_CAPS_TITLE_CLASS}>
                <JournalDocumentTitle>{sheetTitle}</JournalDocumentTitle>
              </div>
            ) : null}
            {toolbar ? <div className={DOC_ADD_ROW_CLASS}>{toolbar}</div> : null}
            {children}
          </div>
        </div>
      </div>

      {extra}
    </div>
  );
}

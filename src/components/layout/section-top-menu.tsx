"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import Link, { useLinkStatus } from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { NewNavEntry, NewNavPanelGroup, NewNavPanelLink } from "@/lib/nav-layout";
import { navTone } from "@/lib/nav-tones";
import { cn } from "@/lib/utils";
import { useIsNarrowViewport } from "@/lib/use-narrow-viewport";
import { useNewDesign } from "@/components/view-prefs/view-prefs-provider";
import { NavIcon, NavIconChip } from "@/components/layout/nav-icons";
import { useNewNavLayout, useNewNavPlace } from "@/components/layout/nav-layout-switch";
import { NavBadge } from "@/components/layout/section-menu-list";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/*
 * Вкладка строки (`[data-top-tab]`): выбранная — скруглённый верх, заливка
 * цветом холста страницы и вогнутые углы снизу, она переходит в страницу
 * (владелец, 2026-11-23: «как вкладку с фоном полукруглым, переход меню в
 * фон»). Форма, наведение и «ножки» — в `app-theme.css` («Строка меню над
 * страницей — вкладки»): там же цвет холста для тёмной темы. При смене
 * выбранной заливка перетекает к новой — жидкое выделение `MotionRuntime`
 * по атрибуту `data-active`.
 *
 * Строке тесно — вкладки плотнее (контейнерный запрос по ширине строки, без
 * замеров после загрузки): уже поля, промежуток и стрелка, на самой узкой —
 * кегль 13px. Иконки остаются всегда.
 */
const TAB = "group/tab relative inline-flex h-10 shrink-0 items-stretch";
const TAB_LINK =
  "relative inline-flex min-w-0 items-center whitespace-nowrap rounded-t-[12px] px-3 text-[13.5px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#5566f6]/15 @max-[1380px]/toprow:px-2 @max-[1260px]/toprow:px-1.5 @max-[1260px]/toprow:text-[13px]";
const TAB_LINK_ACTIVE = "font-semibold text-[#0b1024]";
const TAB_LINK_IDLE = "font-medium text-[#6f7282] group-hover/tab:text-[#0b1024]";
/** Ширина затухания у края строки, из-под которого выглядывает стрелка. */
const FADE_PX = 44;

/**
 * Строка над страницей в шаблоне «Новый»: третий уровень меню. Слева — два
 * уровня (`ClassicSidebarAccordion`), здесь — пункты вложенного раздела или
 * вкладки пункта; первая вкладка — сам раздел, если его страницы нет среди
 * пунктов («Объекты», `buildNewNav`).
 *
 * Пункт с продолжением — одна кнопка списка (владелец, 2026-11-23: «при
 * нажатии по „Журналам“ не должно быть перехода в „Сегодня“ — открывать
 * выпадающее меню»): нажатие на название или стрелку открывает вложенные
 * пункты (`PanelEntry`) — на компьютере панелью, на телефоне листом снизу;
 * сам раздел — первой строкой списка.
 *
 * Одна строка на всех экранах: у длинных пунктов — короткое название
 * (`entry.short`), иконки на месте всегда (раньше прятались по замеру после
 * загрузки и мигали), не хватило ширины — строка прокручивается вбок: на
 * компьютере стрелками по краям, на телефоне пальцем. Выбранный пункт всегда в
 * зоне видимости.
 */
export function SectionTopMenu() {
  const t = useTranslations("navigation.shell");
  const isNew = useNewNavLayout();
  const newDesign = useNewDesign();
  const place = useNewNavPlace();
  const entries = place.entries;
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const entriesKey = entries.map((entry) => `${entry.id}:${entry.short ?? entry.label}`).join("|");
  const activeId = entries.find((entry) => entry.active)?.id ?? null;

  const measure = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const left = box.scrollLeft > 2;
    const right = box.scrollLeft + box.clientWidth < box.scrollWidth - 2;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  // Края прокрутки (стрелки и затухание) и выбранный пункт в зоне видимости.
  // Раскладку строки замеры не меняют: стрелки лежат поверх неё.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const current = box.querySelector<HTMLElement>("[data-top-menu-current]");
    if (current) {
      const start = current.offsetLeft - FADE_PX;
      const end = current.offsetLeft + current.offsetWidth + FADE_PX;
      if (start < box.scrollLeft) box.scrollLeft = Math.max(0, start);
      else if (end > box.scrollLeft + box.clientWidth) box.scrollLeft = end - box.clientWidth;
    }
    measure();
    // Шрифт кабинета догружается после первого кадра — ширины пунктов меняются.
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    if (typeof ResizeObserver === "undefined") return () => void (alive = false);
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    for (const child of Array.from(box.children)) observer.observe(child);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [entriesKey, activeId, measure]);

  // «Новая» тема: все уровни — в дереве меню слева, строка не нужна.
  if (!isNew || newDesign || entries.length === 0) return null;

  const scrollBy = (direction: -1 | 1) => () => {
    const box = scroller.current;
    if (!box) return;
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollBy({ left: direction * Math.max(160, box.clientWidth * 0.6), behavior: reduce ? "auto" : "smooth" });
  };

  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent" : "#000"} 0, #000 ${edges.left ? FADE_PX : 0}px, #000 calc(100% - ${edges.right ? FADE_PX : 0}px), ${edges.right ? "transparent" : "#000"} 100%)`
      : undefined;

  const arrow =
    "absolute top-[calc(50%+3px)] z-10 hidden size-7 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[#3c4053] shadow-[0_4px_12px_-6px_rgba(11,16,36,0.35)] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 lg:flex";

  return (
    <nav aria-label={t("sectionMenuAria")} data-section-top-menu className="relative bg-white print:hidden">
      <div className="@container/toprow relative mx-auto w-full max-w-[1800px]">
        {/* Поля строки: текст первого пункта встаёт на левую границу страницы
            (`px-4 md:px-8` у контента минус поле вкладки 12px). */}
        <div
          ref={scroller}
          onScroll={measure}
          style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
          className="flex flex-nowrap items-end gap-0.5 overflow-x-auto overscroll-x-contain px-1 pt-1.5 [scrollbar-width:none] md:px-5 md:@max-[1260px]/toprow:px-3 [&::-webkit-scrollbar]:hidden"
          data-top-menu-row
        >
          {entries.map((entry) => (
            <TopEntry key={entry.id} entry={entry} />
          ))}
        </div>
        {edges.left ? (
          <button
            type="button"
            onClick={scrollBy(-1)}
            aria-label={t("scrollLeft")}
            title={t("scrollLeft")}
            data-top-menu-scroll="left"
            className={cn(arrow, "left-2 md:left-3")}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
        ) : null}
        {edges.right ? (
          <button
            type="button"
            onClick={scrollBy(1)}
            aria-label={t("scrollRight")}
            title={t("scrollRight")}
            data-top-menu-scroll="right"
            className={cn(arrow, "right-2 md:right-3")}
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </nav>
  );
}

/**
 * Содержимое ссылки-вкладки: иконка, короткое название, метка. Пока переход не
 * завершился, содержимое гаснет, а на его месте крутится загрузка — ширина
 * вкладки та же, соседи не сдвигаются (владелец, 2026-11-23: «текст исчезает и
 * идёт загрузка, как у кнопки»). Задержка — в `app-theme.css`: быстрый переход
 * ничего не показывает.
 */
function TabLabel({ entry }: { entry: NewNavEntry }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span
        data-pending-swap
        data-pending={pending ? "" : undefined}
        className="inline-flex items-center gap-1.5 @max-[1380px]/toprow:gap-1"
      >
        {entry.icon ? (
          <NavIcon
            name={entry.icon}
            className={cn(
              "size-4 shrink-0 transition-colors duration-150",
              entry.active ? "text-[var(--tone)]" : "text-[#9b9fb3] group-hover/tab:text-[var(--tone)]",
            )}
          />
        ) : null}
        <span>{entry.short ?? entry.label}</span>
        {entry.badge ? <NavBadge>{entry.badge}</NavBadge> : null}
      </span>
      {pending ? <Loader2 data-pending-spinner aria-hidden className="absolute inset-0 m-auto size-4 text-[var(--tone)]" /> : null}
    </>
  );
}

/** Содержимое вкладки-кнопки (пункт с вложенными): без ожидания перехода — переход здесь не начинается. */
function TabLabelStatic({ entry }: { entry: NewNavEntry }) {
  return (
    <span className="inline-flex items-center gap-1.5 @max-[1380px]/toprow:gap-1">
      {entry.icon ? (
        <NavIcon
          name={entry.icon}
          className={cn(
            "size-4 shrink-0 transition-colors duration-150",
            entry.active ? "text-[var(--tone)]" : "text-[#9b9fb3] group-hover/tab:text-[var(--tone)]",
          )}
        />
      ) : null}
      <span>{entry.short ?? entry.label}</span>
      {entry.badge ? <NavBadge>{entry.badge}</NavBadge> : null}
    </span>
  );
}

/** Вкладка строки: обёртка с формой вкладки и атрибутом выбора. */
function Tab({ entry, children, tabRef }: { entry: NewNavEntry; children: ReactNode; tabRef?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={tabRef}
      data-top-tab
      data-top-menu-item={entry.id}
      data-top-menu-current={entry.active ? "" : undefined}
      data-active={entry.active ? "" : undefined}
      data-tone={entry.icon ? navTone(entry.icon) : undefined}
      className={TAB}
    >
      {children}
    </div>
  );
}

function TopEntry({ entry }: { entry: NewNavEntry }) {
  if (entry.panel) return <PanelEntry entry={entry} />;
  return (
    <Tab entry={entry}>
      <Link
        href={entry.href}
        aria-current={entry.active ? "page" : undefined}
        title={entry.short ? entry.label : undefined}
        data-top-menu-link={entry.id}
        className={cn(TAB_LINK, entry.active ? TAB_LINK_ACTIVE : TAB_LINK_IDLE)}
      >
        <TabLabel entry={entry} />
      </Link>
    </Tab>
  );
}

// Строка панели: иконка-плашка в цвет пункта и название. Выбранная — фон и
// текст тона, как у выбранного пункта меню слева.
const PANEL_ROW = "gap-2.5 rounded-xl px-2 py-1.5 font-medium";
const PANEL_ROW_ACTIVE = "bg-[var(--tone-row)] text-[var(--tone-ink)]";
const PANEL_CHIP = "size-7 rounded-[9px]";
const PANEL_CHIP_ICON = "size-4";
// Вкладка пункта — мельче и серым, под линией-«веткой» от плашки пункта.
const PANEL_TAB = "rounded-lg px-2 py-1 text-[13px] text-[#6f7282] max-sm:min-h-10";
const PANEL_TAB_ACTIVE = "bg-[var(--tone-row)] font-medium text-[var(--tone-ink)]";

/** Ширина панели по числу колонок (классы статичные — их видит Tailwind). */
const PANEL_WIDTH: Record<number, string> = {
  1: "w-[min(18rem,calc(100vw-2rem))]",
  2: "w-[min(18rem,calc(100vw-2rem))] sm:w-[min(31rem,calc(100vw-2rem))]",
  3: "w-[min(18rem,calc(100vw-2rem))] sm:w-[min(31rem,calc(100vw-2rem))] lg:w-[min(46rem,calc(100vw-2rem))]",
};
const PANEL_COLUMNS: Record<number, string> = {
  1: "",
  2: "sm:grid sm:grid-cols-2",
  3: "sm:grid sm:grid-cols-2 lg:grid-cols-3",
};

/**
 * Пункт с вложенными пунктами — четвёртый уровень меню. Вся вкладка — одна
 * кнопка: нажатие открывает список, перехода в раздел нет (владелец,
 * 2026-11-23). Панель:
 *   • первая строка — сам раздел со стрелкой «открыть» (если его корень не
 *     повторяет один из пунктов);
 *   • у каждого пункта — иконка-плашка своего цвета: строка с плашкой — это
 *     страница;
 *   • вкладки пункта — под ним, мельче, под вертикальной линией от плашки;
 *   • группа — своя колонка с разделителем, на телефоне — лист снизу, группы
 *     друг под другом.
 */
function PanelEntry({ entry }: { entry: NewNavEntry }) {
  const narrow = useIsNarrowViewport();
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const groups = entry.panel ?? [];
  // Одна длинная группа делится на две колонки сама (`columns`); несколько
  // групп — колонка на группу, не больше трёх в ряд.
  const count = groups.reduce((sum, group) => sum + group.links.length, 0);
  const split = groups.length === 1 && count > 8;
  const columns = split ? 2 : Math.min(3, Math.max(1, groups.length));
  // Строка самого раздела сверху — если его корень не повторяет пункт панели.
  const ownRow = !groups.some((group) => group.links.some((link) => link.href === entry.href));
  const expanded = open || sheetOpen;

  const onOpenChange = (next: boolean) => {
    if (next && narrow) {
      setSheetOpen(true);
      return;
    }
    setOpen(next);
  };

  return (
    <Tab entry={entry}>
      {/* Немодальное меню: страница под ним не блокируется и не сдвигается. */}
      <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={entry.short ? entry.label : undefined}
            aria-current={entry.active ? "true" : undefined}
            aria-expanded={expanded}
            data-top-menu-trigger={entry.id}
            data-top-menu-toggle={entry.id}
            data-open={expanded ? "" : undefined}
            className={cn(
              TAB_LINK,
              "gap-1 pr-2 @max-[1380px]/toprow:pr-1.5",
              entry.active ? TAB_LINK_ACTIVE : TAB_LINK_IDLE,
            )}
          >
            <TabLabelStatic entry={entry} />
            <ChevronDown
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 text-[#9b9fb3] transition-transform duration-200 motion-reduce:transition-none group-hover/tab:text-[#0b1024]",
                expanded && "rotate-180 text-[var(--tone)]",
              )}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          collisionPadding={12}
          data-top-menu-panel={entry.id}
          data-nav-flat=""
          className={cn("p-2", PANEL_WIDTH[columns])}
        >
          {ownRow ? (
            <>
              <DropdownMenuItem asChild className={cn(PANEL_ROW, "font-semibold")}>
                <Link href={entry.href} data-nav-row data-tone={entry.icon ? navTone(entry.icon) : undefined} data-top-menu-own>
                  {entry.icon ? (
                    <NavIconChip name={entry.icon} className={PANEL_CHIP} iconClassName={PANEL_CHIP_ICON} />
                  ) : null}
                  <span className="min-w-0 flex-1">{entry.label}</span>
                  {entry.badge ? <NavBadge>{entry.badge}</NavBadge> : null}
                  <ArrowRight aria-hidden className="size-4 text-[#9b9fb3]" />
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="mx-0 my-1.5" />
            </>
          ) : null}
          {split ? (
            <div className="sm:columns-2 sm:gap-x-2" role="group" aria-label={groups[0]?.label ?? undefined}>
              {groups[0]?.links.map((link) => <PanelLink key={link.id} link={link} />)}
            </div>
          ) : (
            <div className={cn(PANEL_COLUMNS[columns], "sm:gap-x-2")}>
              {groups.map((group, index) => (
                <PanelGroup key={group.label ?? `group-${index}`} group={group} index={index} columns={columns} />
              ))}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <PanelSheet entry={entry} open={sheetOpen} onClose={() => setSheetOpen(false)} ownRow={ownRow} />
    </Tab>
  );
}

/** Группа панели: колонка с разделителем слева. */
function PanelGroup({ group, index, columns }: { group: NewNavPanelGroup; index: number; columns: number }) {
  return (
    <div
      role="group"
      aria-label={group.label ?? undefined}
      data-top-menu-group
      className={cn(
        "min-w-0",
        index > 0 && "max-sm:mt-1.5 max-sm:border-t max-sm:border-[var(--app-border)] max-sm:pt-1.5",
        // Разделитель — у колонок, которые не первые в своём ряду.
        columns === 2 && index % 2 === 1 && "sm:border-l sm:border-[var(--app-border)] sm:pl-2",
        columns === 3 &&
          cn(
            index % 2 === 1 && "sm:max-lg:border-l sm:max-lg:border-[var(--app-border)] sm:max-lg:pl-2",
            index % 3 !== 0 && "lg:border-l lg:border-[var(--app-border)] lg:pl-2",
          ),
      )}
    >
      {group.links.map((link) => (
        <PanelLink key={link.id} link={link} />
      ))}
    </div>
  );
}

/** Пункт панели и его вкладки «веткой» под ним. */
function PanelLink({ link }: { link: NewNavPanelLink }) {
  const hasTabs = link.tabs.length > 0;
  const tone = link.icon ? navTone(link.icon) : undefined;
  return (
    <div data-tone={tone} className="break-inside-avoid">
      <DropdownMenuItem
        asChild
        className={cn(
          PANEL_ROW,
          // Выбран сам пункт — фон тона; выбрана его вкладка — пункт только
          // подсвечен цветом: фон достаётся вкладке.
          link.active && (hasTabs ? "font-semibold text-[var(--tone-ink)]" : PANEL_ROW_ACTIVE),
        )}
      >
        <Link
          href={link.href}
          aria-current={link.active ? (hasTabs ? "true" : "page") : undefined}
          data-nav-row
          data-active={link.active ? "" : undefined}
          data-top-menu-link={link.id}
        >
          {link.icon ? <NavIconChip name={link.icon} className={PANEL_CHIP} iconClassName={PANEL_CHIP_ICON} /> : null}
          <span className="min-w-0 flex-1">{link.label}</span>
          {link.badge ? <NavBadge>{link.badge}</NavBadge> : null}
        </Link>
      </DropdownMenuItem>
      {hasTabs ? (
        // Линия — под серединой плашки пункта (поле строки 8px + половина плашки 14px).
        <div className="mt-0.5 mb-1 ml-[21px] border-l border-[var(--app-border-strong)] pl-2" data-top-menu-tabs={link.id}>
          {link.tabs.map((tab) => (
            <DropdownMenuItem key={tab.id} asChild className={cn(PANEL_TAB, tab.active && PANEL_TAB_ACTIVE)}>
              <Link href={tab.href} aria-current={tab.active ? "page" : undefined}>
                {tab.label}
              </Link>
            </DropdownMenuItem>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Строки листа на телефоне — крупные, как в приложениях (`SHEET_ROW_CLASS`).
const SHEET_ROW =
  "flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[15px] font-medium text-[#0b1024] transition-colors hover:bg-[var(--app-veil)] active:bg-[var(--app-veil-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";
const SHEET_ROW_ACTIVE = "bg-[var(--tone-row)] text-[var(--tone-ink)] hover:bg-[var(--tone-row)]";
const SHEET_TAB =
  "flex min-h-11 w-full items-center rounded-xl px-3 text-left text-[14px] text-[#6f7282] transition-colors hover:bg-[var(--app-veil)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Вложенные пункты на телефоне — листом снизу (владелец, 2026-11-23: «чтобы
 * удобно было и вылазило снизу»): строки во всю ширину, группы — друг под
 * другом, вкладки пункта — «веткой». Переход по ссылке закрывает лист.
 */
function PanelSheet({
  entry,
  open,
  onClose,
  ownRow,
}: {
  entry: NewNavEntry;
  open: boolean;
  onClose: () => void;
  ownRow: boolean;
}) {
  const t = useTranslations("navigation.shell");
  const groups = entry.panel ?? [];
  return (
    <BottomSheet open={open} onClose={onClose} title={entry.label}>
      <nav
        aria-label={entry.label}
        data-top-menu-sheet={entry.id}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) onClose();
        }}
        className="flex flex-col gap-0.5 pb-2"
      >
        {ownRow ? (
          <Link
            href={entry.href}
            data-tone={entry.icon ? navTone(entry.icon) : undefined}
            data-top-menu-own
            className={cn(SHEET_ROW, "font-semibold")}
          >
            {entry.icon ? <NavIconChip name={entry.icon} className="size-8 rounded-[10px]" iconClassName="size-[18px]" /> : null}
            <span className="min-w-0 flex-1">{t("openSection")}</span>
            <ArrowRight aria-hidden className="size-4 text-[#9b9fb3]" />
          </Link>
        ) : null}
        {groups.map((group, index) => (
          <div
            key={group.label ?? `group-${index}`}
            role="group"
            aria-label={group.label ?? undefined}
            className={cn("flex flex-col gap-0.5", (index > 0 || ownRow) && "mt-2")}
          >
            {group.label ? (
              <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                {group.label}
              </div>
            ) : null}
            {group.links.map((link) => (
              <div key={link.id} data-tone={link.icon ? navTone(link.icon) : undefined}>
                <Link
                  href={link.href}
                  aria-current={link.active ? "page" : undefined}
                  data-top-menu-link={link.id}
                  className={cn(SHEET_ROW, link.active && link.tabs.length === 0 && SHEET_ROW_ACTIVE)}
                >
                  {link.icon ? <NavIconChip name={link.icon} className="size-8 rounded-[10px]" iconClassName="size-[18px]" /> : null}
                  <span className="min-w-0 flex-1">{link.label}</span>
                  {link.badge ? <NavBadge>{link.badge}</NavBadge> : null}
                </Link>
                {link.tabs.length > 0 ? (
                  <div className="mb-1 ml-[27px] border-l border-[var(--app-border-strong)] pl-2">
                    {link.tabs.map((tab) => (
                      <Link
                        key={tab.id}
                        href={tab.href}
                        aria-current={tab.active ? "page" : undefined}
                        className={cn(SHEET_TAB, tab.active && "bg-[var(--tone-row)] font-medium text-[var(--tone-ink)]")}
                      >
                        {tab.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </nav>
    </BottomSheet>
  );
}

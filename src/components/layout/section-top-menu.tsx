"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { NewNavEntry, NewNavPanelGroup, NewNavPanelLink } from "@/lib/nav-layout";
import { navTone } from "@/lib/nav-tones";
import { cn } from "@/lib/utils";
import { useNewDesign } from "@/components/view-prefs/view-prefs-provider";
import { NavIcon, NavIconChip } from "@/components/layout/nav-icons";
import { useNewNavLayout, useNewNavPlace } from "@/components/layout/nav-layout-switch";
import { NavBadge } from "@/components/layout/section-menu-list";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Пункт строки: иконка, название, метка, стрелка подменю. Иконка серая, у
// выбранного и под курсором — в цвет пункта (`data-tone`, как в меню слева).
const ENTRY =
  "group inline-flex h-11 min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-[13.5px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#5566f6]/15";
const ENTRY_ACTIVE = "border-[#5566f6] font-semibold text-[#0b1024]";
const ENTRY_IDLE = "border-transparent font-medium text-[#6f7282] hover:border-[#dcdfed] hover:text-[#0b1024]";
const ENTRY_ICON = "size-4 shrink-0 transition-colors duration-150 group-data-[dense]/row:hidden";
/** Ширина затухания у края строки, из-под которого выглядывает стрелка. */
const FADE_PX = 44;

/**
 * Строка над страницей в шаблоне «Новый»: третий уровень меню. Слева — два
 * уровня (`ClassicSidebarAccordion`), здесь — пункты вложенного раздела или
 * вкладки пункта. У пункта с продолжением — стрелка и выпадающая панель
 * (`PanelEntry`): четвёртый уровень, под пунктом — его вкладки. Что
 * показывать, считает `buildNewNav` (`lib/nav-layout.ts`).
 *
 * Одна строка на всех экранах (владелец, 2026-11-19: «меню прячется под
 * троеточием»): пункты под «Ещё» больше не уходят. Что делает строка, чтобы
 * пункты поместились, по порядку:
 *   1. у длинных пунктов — короткое название (`entry.short`; полное — в
 *      подсказке и панели);
 *   2. не хватило ширины — прячутся иконки пунктов (в панели они остаются);
 *   3. всё равно не поместилось — строка прокручивается вбок: на компьютере —
 *      стрелками по краям, на телефоне — пальцем.
 * Выбранный пункт всегда в зоне видимости.
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

  // Плотность строки и края прокрутки. Иконки пунктов — украшение: если с ними
  // строка не помещается, они прячутся (`data-dense`) — так пункты чаще
  // остаются на виду без прокрутки, а прокрутка, когда она нужна, короче.
  // Атрибут ставится до первого кадра и мимо React: перерисовка его не
  // сбрасывает.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    let withIcons = 0;
    const fit = () => {
      box.toggleAttribute("data-dense", withIcons > box.clientWidth + 1);
      measure();
    };
    const remeasure = () => {
      box.removeAttribute("data-dense");
      withIcons = box.scrollWidth;
      fit();
    };
    remeasure();
    // Выбранный пункт — в зоне видимости, даже если строка уехала вбок.
    const current = box.querySelector<HTMLElement>("[data-top-menu-current]");
    if (current) {
      const start = current.offsetLeft - FADE_PX;
      const end = current.offsetLeft + current.offsetWidth + FADE_PX;
      if (start < box.scrollLeft) box.scrollLeft = Math.max(0, start);
      else if (end > box.scrollLeft + box.clientWidth) box.scrollLeft = end - box.clientWidth;
      measure();
    }
    // Шрифт кабинета догружается после первого кадра — ширины пунктов меняются.
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) remeasure();
    });
    if (typeof ResizeObserver === "undefined") return () => void (alive = false);
    const observer = new ResizeObserver(fit);
    observer.observe(box);
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
    "absolute top-1/2 z-10 hidden size-7 -translate-y-1/2 items-center justify-center rounded-full border border-[#dcdfed] bg-white text-[#3c4053] shadow-[0_4px_12px_-6px_rgba(11,16,36,0.35)] transition-colors duration-150 hover:border-[#5566f6]/40 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 lg:flex";

  return (
    <nav
      aria-label={t("sectionMenuAria")}
      data-section-top-menu
      className="relative border-b border-[#ececf4] bg-white print:hidden"
    >
      <div className="relative mx-auto w-full max-w-[1800px]">
        {/* Поля строки: текст первого пункта встаёт на левую границу страницы
            (`px-4 md:px-8` у контента минус поле пункта 10px). */}
        <div
          ref={scroller}
          onScroll={measure}
          style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
          className="group/row -mb-px flex flex-nowrap items-stretch overflow-x-auto overscroll-x-contain px-1.5 [scrollbar-width:none] md:px-[22px] [&::-webkit-scrollbar]:hidden"
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

/** Содержимое пункта строки: иконка, короткое название, метка. */
function EntryBody({ entry }: { entry: NewNavEntry }) {
  return (
    <>
      {entry.icon ? (
        <NavIcon
          name={entry.icon}
          className={cn(ENTRY_ICON, entry.active ? "text-[var(--tone)]" : "text-[#9b9fb3] group-hover:text-[var(--tone)]")}
        />
      ) : null}
      <span>{entry.short ?? entry.label}</span>
      {entry.badge ? <NavBadge>{entry.badge}</NavBadge> : null}
    </>
  );
}

function TopEntry({ entry }: { entry: NewNavEntry }) {
  if (entry.panel) return <PanelEntry entry={entry} />;
  return (
    <Link
      href={entry.href}
      aria-current={entry.active ? "page" : undefined}
      data-top-menu-item={entry.id}
      data-top-menu-current={entry.active ? "" : undefined}
      data-tone={entry.icon ? navTone(entry.icon) : undefined}
      title={entry.short ? entry.label : undefined}
      className={cn(ENTRY, entry.active ? ENTRY_ACTIVE : ENTRY_IDLE)}
    >
      <EntryBody entry={entry} />
    </Link>
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
 * Пункт с выпадающей панелью — четвёртый уровень меню.
 *
 * Как читается панель (владелец, 2026-11-19: «где что кликается и какая это
 * вложенность»):
 *   • первая строка — сам раздел со стрелкой «открыть» (если его корень не
 *     повторяет один из пунктов);
 *   • у каждого пункта — иконка-плашка своего цвета: строка с плашкой — это
 *     страница;
 *   • вкладки пункта — под ним, мельче, под вертикальной линией от плашки:
 *     видно, чьи они;
 *   • заголовков групп нет (они были не у всех групп) — группа занимает свою
 *     колонку с разделителем, на телефоне группы идут друг под другом через
 *     линию. Название группы остаётся подписью для экранного диктора.
 */
function PanelEntry({ entry }: { entry: NewNavEntry }) {
  const t = useTranslations("navigation.shell");
  const groups = entry.panel ?? [];
  // Одна длинная группа делится на две колонки сама (`columns`); несколько
  // групп — колонка на группу, не больше трёх в ряд.
  const count = groups.reduce((sum, group) => sum + group.links.length, 0);
  const split = groups.length === 1 && count > 8;
  const columns = split ? 2 : Math.min(3, Math.max(1, groups.length));
  // Строка самого раздела сверху — если его корень не повторяет пункт панели.
  const ownRow = !groups.some((group) => group.links.some((link) => link.href === entry.href));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-current={entry.active ? "true" : undefined}
          data-top-menu-item={entry.id}
          data-top-menu-current={entry.active ? "" : undefined}
          data-tone={entry.icon ? navTone(entry.icon) : undefined}
          title={entry.short ? entry.label : undefined}
          className={cn(ENTRY, entry.active ? ENTRY_ACTIVE : ENTRY_IDLE)}
        >
          <EntryBody entry={entry} />
          <ChevronDown
            aria-hidden
            className="size-3.5 shrink-0 text-[#9b9fb3] transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
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
                <span className="sr-only">{t("openSection")}</span>
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
  );
}

/** Группа панели: колонка с разделителем слева, на телефоне — через линию. */
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

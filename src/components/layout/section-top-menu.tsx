"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, Ellipsis } from "lucide-react";
import type { NewNavEntry } from "@/lib/nav-layout";
import { cn } from "@/lib/utils";
import { useNewDesign } from "@/components/view-prefs/view-prefs-provider";
import { useNewNavLayout, useNewNavPlace } from "@/components/layout/nav-layout-switch";
import { NavBadge } from "@/components/layout/section-menu-list";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Компактнее (владелец, 2026-11-11): строка должна умещаться на экране —
// мельче кегль и поля, длинное название («Программа производственного
// контроля») обрезается многоточием, полное — во всплывающей подсказке.
const ENTRY =
  "inline-flex h-10 min-w-0 shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-2.5 text-[13.5px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";
const ENTRY_LABEL = "max-w-[190px] truncate 2xl:max-w-none";
/** Запас ширины под кнопку «Ещё» (иконка, подпись, поля). */
const MORE_WIDTH = 84;
const ENTRY_ACTIVE = "border-[#5566f6] font-semibold text-[#0b1024]";
const ENTRY_IDLE = "border-transparent font-medium text-[#6f7282] hover:border-[#dcdfed] hover:text-[#0b1024]";
const PANEL_LINK_ACTIVE = "bg-[#f5f6ff] font-semibold text-[#3848c7]";

/**
 * Строка над страницей в шаблоне «Новый»: третий уровень меню. На компьютере
 * — одна строка, лишнее уходит в «Ещё»; на телефоне — прокручивается вбок. Слева — два уровня (`AppSidebarAccordion`), здесь — пункты вложенного
 * раздела или вкладки пункта. У пункта с продолжением — стрелка и выпадающая
 * панель: следующий уровень, под пунктом — его вкладки. Что показывать,
 * считает `buildNewNav` (`lib/nav-layout.ts`).
 */
export function SectionTopMenu() {
  const t = useTranslations("navigation.shell");
  const isNew = useNewNavLayout();
  const newDesign = useNewDesign();
  const place = useNewNavPlace();
  const entries = place.entries;
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  // Сколько пунктов помещается в одну строку; остальные — под «Ещё».
  const [fit, setFit] = useState<number | null>(null);
  const entriesKey = entries.map((entry) => `${entry.id}:${entry.label}`).join("|");

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const compute = () => {
      const widths = [...measure.children].map((child) => (child as HTMLElement).offsetWidth);
      const available = row.clientWidth;
      const total = widths.reduce((sum, width) => sum + width, 0);
      if (total <= available) {
        setFit(null);
        return;
      }
      // Место под кнопку «Ещё» держим всегда, когда что-то не влезло.
      let used = MORE_WIDTH;
      let count = 0;
      for (const width of widths) {
        if (used + width > available) break;
        used += width;
        count += 1;
      }
      setFit(Math.max(1, count));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(row);
    return () => observer.disconnect();
  }, [entriesKey]);

  // «Новая» тема: все уровни — в дереве меню слева, строка не нужна.
  if (!isNew || newDesign || entries.length === 0) return null;

  // Выбранный пункт всегда на виду: не поместился — встаёт последним видимым.
  let visible = entries;
  let hidden: NewNavEntry[] = [];
  if (fit !== null && fit < entries.length) {
    visible = entries.slice(0, fit);
    hidden = entries.slice(fit);
    const activeHidden = hidden.findIndex((entry) => entry.active);
    if (activeHidden >= 0) {
      const [active] = hidden.splice(activeHidden, 1);
      const swapped = visible.pop();
      visible.push(active);
      if (swapped) hidden.unshift(swapped);
    }
  }

  const renderEntry = (entry: NewNavEntry) =>
    entry.panel ? (
      <PanelEntry key={entry.id} entry={entry} />
    ) : (
      <Link
        key={entry.id}
        href={entry.href}
        aria-current={entry.active ? "page" : undefined}
        data-top-menu-item={entry.id}
        title={entry.label}
        className={cn(ENTRY, entry.active ? ENTRY_ACTIVE : ENTRY_IDLE)}
      >
        <span className={ENTRY_LABEL}>{entry.label}</span>
        {entry.badge ? <NavBadge>{entry.badge}</NavBadge> : null}
      </Link>
    );

  return (
    <nav
      aria-label={t("sectionMenuAria")}
      data-section-top-menu
      className="relative border-b border-[#ececf4] bg-white print:hidden"
    >
      {/* Телефон и планшет: та же строка, прокручивается вбок — все пункты
          подряд, без «Ещё» (2026-11-11). */}
      <div
        className="flex flex-nowrap items-stretch overflow-x-auto overscroll-x-contain px-2 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden"
        data-top-menu-strip
      >
        {entries.map(renderEntry)}
      </div>
      {/* Одна строка: что не поместилось по ширине — в «Ещё» справа, а не
          вторым рядом (владелец, 2026-11-11). */}
      <div className="mx-auto hidden w-full max-w-[1800px] px-5 lg:block">
        <div ref={rowRef} className="flex w-full flex-nowrap items-stretch overflow-hidden" data-top-menu-row>
          {visible.map(renderEntry)}
          {hidden.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-top-menu-more
                  aria-label={t("topMenuMore")}
                  title={t("topMenuMore")}
                  className={cn(ENTRY, ENTRY_IDLE, "ml-auto gap-1.5")}
                >
                  <Ellipsis className="size-4" aria-hidden />
                  {t("topMenuMore")}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 p-2" data-top-menu-more-panel>
                {hidden.map((entry) => (
                  <DropdownMenuItem
                    key={entry.id}
                    asChild
                    className={cn("focus:bg-[#f5f6ff]", entry.active && PANEL_LINK_ACTIVE)}
                  >
                    <Link href={entry.href} aria-current={entry.active ? "page" : undefined}>
                      {entry.label}
                      {entry.badge ? <NavBadge>{entry.badge}</NavBadge> : null}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {/* Невидимая копия для замера ширины пунктов. */}
        <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex h-0 flex-nowrap overflow-hidden" data-top-menu-measure>
          {entries.map((entry) => (
            <span key={entry.id} className={cn(ENTRY, entry.active ? ENTRY_ACTIVE : ENTRY_IDLE)}>
              <span className={ENTRY_LABEL}>{entry.label}</span>
              {entry.panel ? <ChevronDown className="size-3.5 shrink-0" /> : null}
              {entry.badge ? <NavBadge>{entry.badge}</NavBadge> : null}
            </span>
          ))}
        </div>
      </div>
    </nav>
  );
}

/** Пункт с выпадающей панелью: сам раздел, ниже — его пункты и их вкладки. */
function PanelEntry({ entry }: { entry: NewNavEntry }) {
  const groups = entry.panel ?? [];
  const count = groups.reduce((sum, group) => sum + group.links.length, 0);
  // Длинный список (журналы, ППК) — в несколько колонок, группа не рвётся.
  const wide = count > 6;
  // Строка самого раздела сверху — если его корень не повторяет пункт панели.
  const ownRow = !groups.some((group) => group.links.some((link) => link.href === entry.href));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-current={entry.active ? "true" : undefined}
          data-top-menu-item={entry.id}
          title={entry.label}
          className={cn(ENTRY, "group", entry.active ? ENTRY_ACTIVE : ENTRY_IDLE)}
        >
          <span className={ENTRY_LABEL}>{entry.label}</span>
          {entry.badge ? <NavBadge>{entry.badge}</NavBadge> : null}
          <ChevronDown
            aria-hidden
            className="size-3.5 shrink-0 text-[#9b9fb3] transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        data-top-menu-panel={entry.id}
        className={cn("p-2", wide ? "w-[min(720px,calc(100vw-2rem))]" : "w-72")}
      >
        {ownRow ? (
          <>
            <DropdownMenuItem asChild className="font-semibold text-[#0b1024] focus:bg-[#f5f6ff]">
              <Link href={entry.href}>
                {entry.label}
                {entry.badge ? <NavBadge>{entry.badge}</NavBadge> : null}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1" />
          </>
        ) : null}
        <div className={wide ? "columns-2 gap-2 xl:columns-3" : undefined}>
          {groups.map((group, index) => (
            <div key={group.label ?? `group-${index}`} className="mb-1 break-inside-avoid">
              {group.label ? (
                <div className="px-2 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#6f7282]">
                  {group.label}
                </div>
              ) : null}
              {group.links.map((link) => (
                <div key={link.id}>
                  <DropdownMenuItem
                    asChild
                    className={cn("focus:bg-[#f5f6ff]", link.active && link.tabs.length === 0 && PANEL_LINK_ACTIVE)}
                  >
                    <Link href={link.href} aria-current={link.active ? (link.tabs.length > 0 ? "true" : "page") : undefined}>
                      {link.label}
                      {link.badge ? <NavBadge>{link.badge}</NavBadge> : null}
                    </Link>
                  </DropdownMenuItem>
                  {link.tabs.map((tab) => (
                    <DropdownMenuItem
                      key={tab.id}
                      asChild
                      className={cn("pl-6 text-[13px] focus:bg-[#f5f6ff]", tab.active && PANEL_LINK_ACTIVE)}
                    >
                      <Link href={tab.href} aria-current={tab.active ? "page" : undefined}>
                        {tab.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

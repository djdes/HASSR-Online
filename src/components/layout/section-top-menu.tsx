"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { NewNavEntry } from "@/lib/nav-layout";
import { cn } from "@/lib/utils";
import { useNewNavLayout, useNewNavPlace } from "@/components/layout/nav-layout-switch";
import { NavBadge } from "@/components/layout/section-menu-list";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ENTRY =
  "inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[14.5px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";
const ENTRY_ACTIVE = "border-[#5566f6] font-semibold text-[#0b1024]";
const ENTRY_IDLE = "border-transparent font-medium text-[#6f7282] hover:border-[#dcdfed] hover:text-[#0b1024]";
const PANEL_LINK_ACTIVE = "bg-[#f5f6ff] font-semibold text-[#3848c7]";

/**
 * Строка над страницей в шаблоне «Новый» (только компьютер): третий уровень
 * меню. Слева — два уровня (`AppSidebarAccordion`), здесь — пункты вложенного
 * раздела или вкладки пункта. У пункта с продолжением — стрелка и выпадающая
 * панель: следующий уровень, под пунктом — его вкладки. Что показывать,
 * считает `buildNewNav` (`lib/nav-layout.ts`).
 */
export function SectionTopMenu() {
  const t = useTranslations("navigation.shell");
  const isNew = useNewNavLayout();
  const place = useNewNavPlace();
  if (!isNew || place.entries.length === 0) return null;

  return (
    <nav
      aria-label={t("sectionMenuAria")}
      data-section-top-menu
      className="hidden border-b border-[#ececf4] bg-white lg:block print:hidden"
    >
      {/* Длинная строка переносится: ни один пункт не прячется за краем. */}
      <div className="mx-auto flex w-full max-w-[1800px] flex-wrap items-stretch gap-x-1 px-8">
        {place.entries.map((entry) =>
          entry.panel ? (
            <PanelEntry key={entry.id} entry={entry} />
          ) : (
            <Link
              key={entry.id}
              href={entry.href}
              aria-current={entry.active ? "page" : undefined}
              data-top-menu-item={entry.id}
              className={cn(ENTRY, entry.active ? ENTRY_ACTIVE : ENTRY_IDLE)}
            >
              {entry.label}
              {entry.badge ? <NavBadge>{entry.badge}</NavBadge> : null}
            </Link>
          ),
        )}
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
          className={cn(ENTRY, "group", entry.active ? ENTRY_ACTIVE : ENTRY_IDLE)}
        >
          {entry.label}
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-[#9b9fb3] transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
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
              <Link href={entry.href}>{entry.label}</Link>
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

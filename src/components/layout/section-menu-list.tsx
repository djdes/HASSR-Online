"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { NavModelSection } from "@/lib/app-nav.server";
import type { NavSectionKey } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/layout/nav-icons";
import { SectionStatusDot } from "@/components/layout/section-status-dot";
import type { PpkNavStatus } from "@/components/layout/use-section-statuses";

// Пункт меню раздела: 48px высотой, как строки оглавления на телефоне.
const SECTION_ROW =
  "flex min-h-[48px] items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[16px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

// Строка раздела в главном меню листа: от 52px высотой, шрифт 17px, иконка
// 24px — палец попадает с первого раза.
const MAIN_ROW =
  "flex min-h-[52px] items-center gap-3.5 rounded-2xl px-3.5 py-3 text-[17px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Список меню раздела для листа снизу: заголовок-ссылка на корень раздела,
 * группы и пункты с точками статуса. Общий для мобильного листа сайта и
 * кнопки меню в Mini App (П-3).
 */
export function SectionMenuList({
  section,
  activeItemId,
  statuses,
}: {
  section: NavModelSection;
  activeItemId: string | undefined;
  statuses: Record<string, PpkNavStatus>;
}) {
  if (!section.menu) return null;
  return (
    <>
      <Link
        href={section.rootHref}
        className="rounded-xl px-2.5 pt-1 pb-1.5 text-[17px] font-semibold text-[#0b1024] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
      >
        {section.label}
      </Link>
      {section.menu.map((group, index) => (
        <div key={group.label ?? `group-${index}`} className="flex flex-col gap-1">
          {group.label ? (
            <div className="px-2.5 pt-3 pb-1 text-[12px] font-semibold text-[#9b9fb3]">{group.label}</div>
          ) : null}
          {group.items.map((item) => {
            const isActive = activeItemId === item.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                data-menu-item={item.id}
                className={cn(
                  SECTION_ROW,
                  isActive ? "bg-[#f5f6ff] text-[#5566f6]" : "text-[#3c4053] hover:bg-[#fafbff]",
                )}
              >
                <NavIcon
                  name={item.icon}
                  className={cn("size-5 shrink-0", isActive ? "text-[#5566f6]" : "text-[#6f7282]")}
                />
                <span className="min-w-0">{item.label}</span>
                <SectionStatusDot status={statuses[item.id]} />
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

/**
 * Стрелка › у пункта главного меню, у которого есть своё меню раздела
 * (руководитель: «все меню, которые разворачиваются, должны быть со
 * стрелочкой»). Видна всегда, не только у активного пункта и не только при
 * наведении; при наведении на пункт чуть сдвигается и становится индиго.
 */
export function NavChevron({ active = false, className }: { active?: boolean; className?: string }) {
  return (
    <ChevronRight
      aria-hidden
      data-nav-chevron
      className={cn(
        "size-4 shrink-0 transition-[color,transform] duration-150 motion-reduce:transition-none",
        active ? "text-[#5566f6]" : "text-[#9b9fb3] group-hover:translate-x-0.5 group-hover:text-[#5566f6]",
        className,
      )}
    />
  );
}

/**
 * Девять разделов списком для листа снизу (главное меню). «Пришла проверка» —
 * под чертой, контурной кнопкой, как в сайдбаре. Общий для листа сайта и листа
 * Mini App.
 *
 * У раздела со своим меню — стрелка ›, и с `onOpenMenu` нажатие раскрывает
 * его меню прямо в листе (стрелка обещает именно это), а не уводит на корень
 * раздела с закрытием листа. Раздел без меню («Остальное») — обычная ссылка.
 */
export function NavSectionsList({
  sections,
  active,
  onOpenMenu,
}: {
  sections: NavModelSection[];
  active: NavSectionKey | null;
  onOpenMenu?: (key: NavSectionKey) => void;
}) {
  return (
    <>
      {sections.map((section) => {
        const isActive = active === section.key;
        const action = section.key === "inspection";
        const className = cn(
          MAIN_ROW,
          "group w-full text-left",
          action
            ? isActive
              ? "border border-[#5566f6]/25 bg-[#f5f6ff] text-[#5566f6]"
              : "border border-[#dcdfed] bg-white text-[#3848c7] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            : isActive
              ? "bg-[#f5f6ff] text-[#5566f6]"
              : "text-[#3c4053] hover:bg-[#fafbff]",
        );
        const content = (
          <>
            <NavIcon
              name={section.icon}
              className={cn("size-6 shrink-0", isActive || action ? "text-[#5566f6]" : "text-[#6f7282]")}
            />
            <span className="min-w-0 flex-1">{section.label}</span>
            {section.menu ? <NavChevron active={isActive} className="size-5" /> : null}
          </>
        );
        const row =
          section.menu && onOpenMenu ? (
            <button
              key={section.key}
              type="button"
              onClick={() => onOpenMenu(section.key)}
              aria-current={isActive ? "page" : undefined}
              data-nav-section={section.key}
              data-nav-action={action ? "" : undefined}
              className={className}
            >
              {content}
            </button>
          ) : (
            <Link
              key={section.key}
              href={section.rootHref}
              aria-current={isActive ? "page" : undefined}
              data-nav-section={section.key}
              data-nav-action={action ? "" : undefined}
              className={className}
            >
              {content}
            </Link>
          );
        return action ? (
          <div key={section.key} className="mt-1 border-t border-[#ececf4] pt-2">
            {row}
          </div>
        ) : (
          row
        );
      })}
    </>
  );
}

/**
 * Что показано в листе меню (сайт на телефоне и Mini App): меню раздела или
 * главное меню. По умолчанию — меню текущего раздела (если оно есть), иначе
 * главное. «‹ Главное меню» и нажатие на раздел со стрелкой переключают лист
 * на месте, без перехода; выбор помним вместе с путём — после перехода или
 * закрытия листа (`reset`) снова видно меню текущего раздела. Фокус не
 * теряется: после входа в раздел — на «‹ Главное меню», после выхода — на
 * строку раздела, из которого вышли.
 */
export function useSheetMenu({
  scope,
  sections,
  currentKey,
  pathname,
}: {
  /** Метка листа: `data-sheet-menu={scope}` на его `nav` — там ищем, куда поставить фокус. */
  scope: string;
  sections: NavModelSection[];
  currentKey: NavSectionKey | null;
  pathname: string;
}) {
  // `focus` — куда поставить фокус после переключения: "back" или ключ раздела.
  const [view, setView] = useState<{ path: string; key: NavSectionKey | "main"; focus: string } | null>(null);
  const current = view && view.path === pathname ? view : null;
  const viewKey = current ? current.key : (currentKey ?? "main");
  const shown = viewKey === "main" ? undefined : sections.find((section) => section.key === viewKey && section.menu);
  useEffect(() => {
    if (!current) return;
    const box = document.querySelector(`[data-sheet-menu="${scope}"]`);
    const element =
      current.focus === "back"
        ? box?.querySelector<HTMLElement>("button[data-back-to-main]")
        : (box?.querySelector<HTMLElement>(`[data-nav-section="${current.focus}"]`) ??
          box?.querySelector<HTMLElement>("[data-nav-section]"));
    element?.focus();
  }, [current, scope]);
  return {
    /** Раздел, чьё меню сейчас в листе; `undefined` — главное меню. */
    shown,
    /** Раскрыть меню раздела в листе. */
    openMenu: (key: NavSectionKey) => setView({ path: pathname, key, focus: "back" }),
    /** Вернуться к главному меню. */
    showMain: () => setView({ path: pathname, key: "main", focus: shown?.key ?? "main" }),
    reset: () => setView(null),
  };
}

/** «‹ Главное меню» в листе: переключает его с меню раздела на девять разделов. */
export function BackToMainButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations("navigation.shell");
  return (
    <button
      type="button"
      onClick={onClick}
      data-back-to-main
      className="inline-flex h-11 items-center gap-1 self-start rounded-xl px-2.5 text-[15px] font-semibold text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
    >
      <ChevronLeft className="size-5" aria-hidden />
      {t("backToMain")}
    </button>
  );
}

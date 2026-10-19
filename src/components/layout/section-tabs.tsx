"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { activeMenuItemId, sectionForPath } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { useAppNav } from "@/components/layout/app-nav-context";

/**
 * Вкладки раздела над основным окном: «Сегодня · Все журналы · Проверка ·
 * Настройка». Только на корневых страницах раздела и только если вкладок
 * две и больше — на глубоких страницах место занимают крошки.
 *
 * `nav` + `aria-current`, а не `role="tablist"`: глобальный CSS на
 * телефонах переносит tablist'ы на несколько строк, а здесь нужна одна
 * строка со скроллом вбок (как у прежних вкладок точек).
 */
/**
 * Где мы относительно меню. В обычном разделе: на корне (адрес одной из
 * ВИДИМЫХ вкладок) — рисуем вкладки и не рисуем крошки, глубже — наоборот.
 * В разделе с меню (`section.menu`): `menuItem` — пункт меню, которому
 * принадлежит путь, `menuTab` — его вкладка; `depth` — "item" на самом пункте
 * (или адресе его вкладки), "deep" — глубже. Один расчёт на `SectionTabs`,
 * `SectionFrame`, `PageNav` и сайдбар, чтобы они не разошлись.
 */
export function useSectionPlace() {
  const { sections } = useAppNav();
  const pathname = usePathname() || "/";
  const owner = sectionForPath(pathname);
  const section = owner ? sections.find((item) => item.key === owner.section) : undefined;
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const atRoot = Boolean(section?.tabs.some((tab) => tab.href === clean));
  // Пункты из данных (точки) в статической модели не значатся — страница точки
  // достаётся своему пункту по адресам меню человека (`activeMenuItemId`).
  const items = section?.menu?.flatMap((group) => group.items) ?? [];
  const itemId = owner && items.length > 0 ? activeMenuItemId(pathname, items.map((entry) => entry.id)) : null;
  const menuItem = itemId ? items.find((entry) => entry.id === itemId) : undefined;
  const menuTab = menuItem?.tabs?.find((tab) => tab.href === clean);
  let depth: "item" | "deep" | null = null;
  if (menuItem) depth = clean === menuItem.href || menuTab ? "item" : "deep";
  const activeHref = section?.menu ? (menuTab?.href ?? null) : atRoot ? clean : null;
  return { section, atRoot, menuItem, menuTab, depth, activeHref };
}

export function SectionTabs({ className }: { className?: string }) {
  const t = useTranslations("navigation.shell");
  const { section, atRoot, menuItem, depth, activeHref } = useSectionPlace();
  // В разделе с меню — вкладки текущего пункта (только на самом пункте);
  // в остальных разделах — вкладки раздела на их корнях.
  const tabs = section?.menu
    ? depth === "item"
      ? (menuItem?.tabs ?? [])
      : []
    : atRoot
      ? (section?.tabs ?? [])
      : [];

  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const left = box.scrollLeft > 2;
    const right = box.scrollLeft + box.clientWidth < box.scrollWidth - 2;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  // Активная вкладка — в зоне видимости, даже если строка уехала вбок.
  useEffect(() => {
    const box = scroller.current;
    const current = box?.querySelector<HTMLElement>("[aria-current]");
    if (box && current) {
      box.scrollLeft = Math.max(0, current.offsetLeft - (box.clientWidth - current.offsetWidth) / 2);
    }
    measure();
  }, [activeHref, tabs.length, measure]);

  useEffect(() => {
    const box = scroller.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [measure]);

  if (tabs.length < 2) return null;

  const fade = 28;
  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent" : "#000"} 0, #000 ${edges.left ? fade : 0}px, #000 calc(100% - ${edges.right ? fade : 0}px), ${edges.right ? "transparent" : "#000"} 100%)`
      : undefined;

  return (
    <nav
      aria-label={t("tabsAria")}
      data-section-tabs={section?.key}
      className={cn("mb-5 min-w-0 border-b border-[#ececf4] print:hidden max-sm:mb-4", className)}
    >
      <div
        ref={scroller}
        onScroll={measure}
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
        className="-mb-px flex min-w-0 flex-nowrap gap-6 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const isActive = tab.href === activeHref;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              data-section-tab={tab.id}
              className={cn(
                "relative inline-flex h-11 shrink-0 items-center whitespace-nowrap border-b-2 text-[14.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                isActive
                  ? "border-[#5566f6] text-[#0b1024]"
                  : "border-transparent text-[#6f7282] hover:border-[#dcdfed] hover:text-[#0b1024]",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

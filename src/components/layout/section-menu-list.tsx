"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
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
 * Девять разделов списком для листа снизу (главное меню). «Пришла проверка» —
 * под чертой, как в сайдбаре. Общий для листа сайта и листа Mini App.
 */
export function NavSectionsList({
  sections,
  active,
}: {
  sections: NavModelSection[];
  active: NavSectionKey | null;
}) {
  return (
    <>
      {sections.map((section) => {
        const isActive = active === section.key;
        const row = (
          <Link
            key={section.key}
            href={section.rootHref}
            aria-current={isActive ? "page" : undefined}
            data-nav-section={section.key}
            className={cn(MAIN_ROW, isActive ? "bg-[#f5f6ff] text-[#5566f6]" : "text-[#3c4053] hover:bg-[#fafbff]")}
          >
            <NavIcon
              name={section.icon}
              className={cn("size-6 shrink-0", isActive ? "text-[#5566f6]" : "text-[#6f7282]")}
            />
            <span className="min-w-0">{section.label}</span>
          </Link>
        );
        return section.key === "inspection" ? (
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

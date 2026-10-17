"use client";

import Link from "next/link";
import type { NavModelSection } from "@/lib/app-nav.server";
import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/layout/nav-icons";
import { SectionStatusDot } from "@/components/layout/section-status-dot";
import type { PpkNavStatus } from "@/components/layout/use-section-statuses";

// Пункт меню раздела: 48px высотой, как строки оглавления на телефоне.
const SECTION_ROW =
  "flex min-h-[48px] items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[16px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

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

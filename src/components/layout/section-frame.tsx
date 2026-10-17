"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSectionPlace } from "@/components/layout/section-tabs";

/**
 * Рамка страницы в разделе с меню (`section.menu`): на глубоких страницах
 * пункта — ссылка «‹ {пункт}» на сам пункт. Где человек и что дальше, показывает
 * меню раздела слева, поэтому оглавления, полос и «Назад/Дальше» здесь нет.
 * В остальных разделах и на самих пунктах — дети как есть.
 */
export function SectionFrame({ children }: { children: React.ReactNode }) {
  const { menuItem, depth } = useSectionPlace();

  if (!menuItem || depth !== "deep") return <>{children}</>;

  return (
    <>
      <Link
        href={menuItem.href}
        className={cn(
          "mb-3 inline-flex items-center gap-1 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] print:hidden",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
        )}
      >
        <ChevronLeft className="size-4" />
        {menuItem.label}
      </Link>
      {children}
    </>
  );
}

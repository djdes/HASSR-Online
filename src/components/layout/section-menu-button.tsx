"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Menu } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { SectionMenuList } from "@/components/layout/section-menu-list";
import { useSectionPlace } from "@/components/layout/section-tabs";
import { useSectionStatuses } from "@/components/layout/use-section-statuses";

/**
 * Меню раздела в Mini App (П-3): полоса над вкладками, по нажатию — лист со
 * списком пунктов. Показывается, только когда путь принадлежит разделу с
 * меню; «Главное меню» не нужно — у приложения свои нижние вкладки.
 */
export function SectionMenuButton() {
  const t = useTranslations("navigation.shell");
  const { section, menuItem } = useSectionPlace();
  const [open, setOpen] = useState(false);
  const menuSection = section?.menu ? section : undefined;
  const statuses = useSectionStatuses(open ? menuSection?.key : undefined);
  if (!menuSection) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("sectionMenuAria")}
        data-section-menu-button={menuSection.key}
        className="mb-4 flex h-12 w-full items-center gap-3 rounded-2xl border border-[#dcdfed] bg-white px-3 text-left transition-colors duration-150 hover:bg-[#fafbff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 print:hidden"
      >
        <Menu className="size-5 shrink-0 text-[#5566f6]" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[11px] text-[#9b9fb3]">{menuSection.label}</span>
          <span className="truncate text-[15px] font-semibold text-[#0b1024]">
            {menuItem?.label ?? menuSection.label}
          </span>
        </span>
        <ChevronDown className="size-5 shrink-0 text-[#6f7282]" aria-hidden />
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={menuSection.label}>
        <nav
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) setOpen(false);
          }}
          aria-label={t("sectionMenuAria")}
          className="flex flex-col gap-1"
          data-section-menu={menuSection.key}
        >
          <SectionMenuList section={menuSection} activeItemId={menuItem?.id} statuses={statuses} />
        </nav>
      </BottomSheet>
    </>
  );
}

"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, Menu } from "lucide-react";
import { sectionForPath } from "@/lib/app-nav";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useAppNav } from "@/components/layout/app-nav-context";
import { OrganizationBrand } from "@/components/layout/organization-brand";
import { BackToMainButton, NavSectionsList, SectionMenuList } from "@/components/layout/section-menu-list";
import { useSectionPlace } from "@/components/layout/section-tabs";
import { useSectionStatuses } from "@/components/layout/use-section-statuses";

/**
 * Меню раздела в Mini App (П-3): полоса над вкладками, по нажатию — лист, как
 * бургер сайта: логотип компании клиента, «‹ Главное меню» и пункты раздела.
 * «‹ Главное меню» переключает лист на девять разделов. Показывается, когда
 * путь принадлежит разделу с меню и разделов у человека два и больше (повару
 * с одним разделом меню не нужно — как и бургер на сайте).
 */
export function SectionMenuButton({
  brand,
}: {
  brand: { logoUrl: string | null; name: string; homeHref: string; canEditBranding: boolean };
}) {
  const t = useTranslations("navigation.shell");
  const { sections, showSidebar } = useAppNav();
  const pathname = usePathname() || "/";
  const { section, menuItem } = useSectionPlace();
  const [open, setOpen] = useState(false);
  const [showMain, setShowMain] = useState(false);
  const menuSection = showSidebar && section?.menu ? section : undefined;
  const statuses = useSectionStatuses(open ? menuSection?.key : undefined);
  if (!menuSection) return null;

  const close = () => {
    setOpen(false);
    setShowMain(false);
  };

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
      <BottomSheet open={open} onClose={close} title={showMain ? t("backToMain") : menuSection.label}>
        <nav
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) close();
          }}
          aria-label={showMain ? t("sidebarAria") : t("sectionMenuAria")}
          className="flex flex-col gap-1"
          data-section-menu={showMain ? undefined : menuSection.key}
          data-mini-menu-mode={showMain ? "main" : "section"}
        >
          <OrganizationBrand
            logoUrl={brand.logoUrl}
            name={brand.name}
            homeHref={brand.homeHref}
            canEditBranding={brand.canEditBranding}
            className="mb-1 min-h-12 px-2.5"
          />
          {showMain ? (
            <NavSectionsList sections={sections} active={sectionForPath(pathname)?.section ?? null} />
          ) : (
            <>
              <BackToMainButton onClick={() => setShowMain(true)} />
              <SectionMenuList section={menuSection} activeItemId={menuItem?.id} statuses={statuses} />
            </>
          )}
        </nav>
      </BottomSheet>
    </>
  );
}

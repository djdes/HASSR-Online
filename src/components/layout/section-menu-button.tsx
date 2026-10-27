"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, Menu } from "lucide-react";
import { sectionForPath } from "@/lib/app-nav";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useAppNav } from "@/components/layout/app-nav-context";
import { OrganizationBrand } from "@/components/layout/organization-brand";
import {
  BackToMainButton,
  NavSectionsList,
  SectionMenuList,
  menuHostKey,
  useSheetMenu,
} from "@/components/layout/section-menu-list";
import { useSectionPlace } from "@/components/layout/section-tabs";
import { useSectionStatuses } from "@/components/layout/use-section-statuses";

/**
 * Меню раздела в Mini App (П-3): полоса над вкладками, по нажатию — лист, как
 * бургер сайта: логотип компании клиента, «‹ Назад» и пункты раздела.
 * «‹ Назад» переключает лист на меню уровнем выше; раздел со стрелкой ›
 * раскрывает своё меню на месте. Показывается, когда путь принадлежит разделу
 * с меню и разделов у человека два и больше (повару с одним разделом меню не
 * нужно — как и бургер на сайте).
 *
 * На полосе — «Меню раздела» и название раздела, а не пункта: название
 * страницы уже стоит в шапке приложения и в заголовке страницы, третий раз
 * его не повторяем.
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
  const currentKey = sectionForPath(pathname)?.section ?? null;
  // Раздел без своего меню («Остальное») — в меню родителя.
  const hostKey = menuHostKey(sections, currentKey);
  const menuSection = showSidebar && hostKey ? sections.find((entry) => entry.key === hostKey) : undefined;
  const menu = useSheetMenu({ scope: "mini", sections, currentKey: menuSection?.key ?? null, pathname });
  const shown = menu.shown;
  const statuses = useSectionStatuses(open && shown ? shown.key : undefined);
  if (!menuSection) return null;

  const close = () => {
    setOpen(false);
    menu.reset();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${t("sectionMenuAria")}: ${menuSection.label}`}
        data-section-menu-button={menuSection.key}
        className="mb-4 flex h-12 w-full items-center gap-3 rounded-2xl border border-[#dcdfed] bg-white px-3 text-left transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 print:hidden"
      >
        <Menu className="size-5 shrink-0 text-[#5566f6]" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[11px] text-[#9b9fb3]">{t("sectionMenuAria")}</span>
          <span className="truncate text-[15px] font-semibold text-[#0b1024]">{menuSection.label}</span>
        </span>
        <ChevronDown className="size-5 shrink-0 text-[#6f7282]" aria-hidden />
      </button>
      <BottomSheet open={open} onClose={close} title={shown ? shown.label : t("backToMain")}>
        <nav
          data-sheet-menu="mini"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) close();
          }}
          aria-label={shown ? t("sectionMenuAria") : t("sidebarAria")}
          className="flex flex-col gap-1"
          data-section-menu={shown?.key}
          data-mini-menu-mode={shown ? "section" : "main"}
        >
          <OrganizationBrand
            logoUrl={brand.logoUrl}
            name={brand.name}
            homeHref={brand.homeHref}
            canEditBranding={brand.canEditBranding}
            className="mb-1 min-h-12 px-2.5"
          />
          {shown?.menu ? (
            <>
              <BackToMainButton onClick={menu.back} />
              <SectionMenuList
                section={shown}
                activeItemId={shown.key === section?.key ? menuItem?.id : undefined}
                currentKey={currentKey}
                statuses={statuses}
                onOpenMenu={menu.openMenu}
              />
            </>
          ) : (
            <NavSectionsList sections={sections} currentKey={currentKey} onOpenMenu={menu.openMenu} />
          )}
        </nav>
      </BottomSheet>
    </>
  );
}

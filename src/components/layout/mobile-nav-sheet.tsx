"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { sectionForPath } from "@/lib/app-nav";
import type { BuildingOption } from "@/lib/building-scope";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useAppNav } from "@/components/layout/app-nav-context";
import { LocationSwitcherList } from "@/components/layout/location-switcher";
import { OrganizationBrand } from "@/components/layout/organization-brand";
import {
  BackToMainButton,
  NavSectionsList,
  SectionMenuList,
  useSheetMenu,
} from "@/components/layout/section-menu-list";
import { useSectionPlace } from "@/components/layout/section-tabs";
import { useSectionStatuses } from "@/components/layout/use-section-statuses";

// Строка мобильного меню: от 52px высотой, шрифт 17px, иконка 24px —
// палец попадает с первого раза.
const ROW =
  "flex min-h-[52px] items-center gap-3.5 rounded-2xl px-3.5 py-3 text-[17px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Меню на телефоне и планшете (<1024px): тот же список разделов, что в
 * сайдбаре, — листом снизу. Сверху логотип компании клиента и точки (если их
 * несколько), внизу выход. В разделе с меню (`section.menu`) лист открывается
 * с меню раздела: кнопка «‹ Главное меню» переключает его на список разделов,
 * а нажатие на раздел со стрелкой › раскрывает его меню прямо в листе.
 */
export function MobileNavSheet({
  open,
  onClose,
  buildings,
  activeBuildingId,
  onLogout,
  brand,
}: {
  open: boolean;
  onClose: () => void;
  buildings: BuildingOption[];
  activeBuildingId: string | null;
  onLogout: () => void;
  brand: { logoUrl: string | null; name: string; homeHref: string; canEditBranding: boolean };
}) {
  const t = useTranslations("navigation.shell");
  const { sections } = useAppNav();
  const pathname = usePathname() || "/";
  const active = sectionForPath(pathname)?.section ?? null;
  const { section: placeSection, menuItem } = useSectionPlace();
  // Меню раздела или главное меню в листе; раздел со стрелкой раскрывается на месте.
  const menu = useSheetMenu({
    scope: "mobile",
    sections,
    currentKey: placeSection?.menu ? placeSection.key : null,
    pathname,
  });
  const shown = menu.shown;
  const statuses = useSectionStatuses(open && shown ? shown.key : undefined);
  const close = () => {
    menu.reset();
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title={t("menu")}
      footer={
        <button
          type="button"
          onClick={onLogout}
          className={cn(ROW, "w-full text-[#a13a32] hover:bg-[#fff4f2]")}
        >
          <LogOut className="size-6 shrink-0" />
          {t("logout")}
        </button>
      }
    >
      <nav
        data-sheet-menu="mobile"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) close();
        }}
        className="flex flex-col gap-1"
        data-mobile-nav
        data-mobile-nav-mode={shown ? "section" : "main"}
        data-mobile-nav-section={shown?.key}
      >
        {/* Логотип компании клиента — над меню, как в сайдбаре (эскиз руководителя). */}
        <OrganizationBrand
          logoUrl={brand.logoUrl}
          name={brand.name}
          homeHref={brand.homeHref}
          canEditBranding={brand.canEditBranding}
          className="mb-1 min-h-12 px-2.5"
        />
        {shown?.menu ? (
          <>
            <BackToMainButton onClick={menu.showMain} />
            <SectionMenuList
              section={shown}
              activeItemId={shown.key === placeSection?.key ? menuItem?.id : undefined}
              statuses={statuses}
            />
          </>
        ) : (
          <>
            {buildings.length >= 2 ? (
              <LocationSwitcherList buildings={buildings} activeBuildingId={activeBuildingId} />
            ) : null}
            <NavSectionsList sections={sections} active={active} onOpenMenu={menu.openMenu} />
          </>
        )}
      </nav>
    </BottomSheet>
  );
}

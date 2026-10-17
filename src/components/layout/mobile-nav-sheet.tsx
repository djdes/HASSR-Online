"use client";

import { useEffect, useRef, useState } from "react";
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
import { BackToMainButton, NavSectionsList, SectionMenuList } from "@/components/layout/section-menu-list";
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
 * с меню раздела: кнопка «‹ Главное меню» переключает его на список разделов.
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
  const menuSection = placeSection?.menu ? placeSection : undefined;
  // «Показан список разделов» помним вместе с путём; закрытие листа сбрасывает.
  const [mainShownFor, setMainShownFor] = useState<string | null>(null);
  const showSection = Boolean(menuSection) && mainShownFor !== pathname;
  const statuses = useSectionStatuses(open && showSection ? menuSection?.key : undefined);
  // Кнопка «‹ Главное меню» исчезает при переключении — фокус на пункт текущего раздела.
  const navRef = useRef<HTMLElement>(null);
  const focusMain = useRef(false);
  useEffect(() => {
    if (!focusMain.current || showSection) return;
    focusMain.current = false;
    navRef.current
      ?.querySelector<HTMLElement>(active ? `[data-nav-section="${active}"]` : "a")
      ?.focus();
  }, [showSection, active]);
  const close = () => {
    setMainShownFor(null);
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
        ref={navRef}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) close();
        }}
        className="flex flex-col gap-1"
        data-mobile-nav
        data-mobile-nav-mode={showSection ? "section" : "main"}
      >
        {/* Логотип компании клиента — над меню, как в сайдбаре (эскиз руководителя). */}
        <OrganizationBrand
          logoUrl={brand.logoUrl}
          name={brand.name}
          homeHref={brand.homeHref}
          canEditBranding={brand.canEditBranding}
          className="mb-1 min-h-12 px-2.5"
        />
        {showSection && menuSection?.menu ? (
          <>
            <BackToMainButton
              onClick={() => {
                focusMain.current = true;
                setMainShownFor(pathname);
              }}
            />
            <SectionMenuList section={menuSection} activeItemId={menuItem?.id} statuses={statuses} />
          </>
        ) : (
          <>
            {buildings.length >= 2 ? (
              <LocationSwitcherList buildings={buildings} activeBuildingId={activeBuildingId} />
            ) : null}
            <NavSectionsList sections={sections} active={active} />
          </>
        )}
      </nav>
    </BottomSheet>
  );
}

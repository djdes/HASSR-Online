"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { sectionForPath } from "@/lib/app-nav";
import type { BuildingOption } from "@/lib/building-scope";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useAppNav } from "@/components/layout/app-nav-context";
import { LocationSwitcherList } from "@/components/layout/location-switcher";
import { NavIconChip } from "@/components/layout/nav-icons";
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
import type { SidebarOrgIdentity } from "@/lib/sidebar-org-identity";

// Строка мобильного меню: от 52px высотой, шрифт 17px, иконка 24px —
// палец попадает с первого раза.
// Строка как у разделов листа: плашка 40px слева (цвет «Выйти» — розовый).
const ROW =
  "flex min-h-[52px] items-center gap-3 rounded-2xl py-1.5 pr-3.5 pl-1.5 text-[17px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Меню на телефоне и планшете (<1024px): тот же список разделов, что в
 * сайдбаре, — листом снизу. Сверху логотип компании клиента и точки (если их
 * несколько), внизу выход. В разделе с меню (`section.menu`) лист открывается
 * с меню раздела: кнопка «‹ Назад» переключает его на меню уровнем выше,
 * а нажатие на раздел со стрелкой › раскрывает его меню прямо в листе;
 * «‹ Назад» поднимает на уровень вверх (вложенные разделы, 2026-10-28).
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
  brand: {
    logoUrl: string | null;
    name: string;
    identity: SidebarOrgIdentity;
    homeHref: string;
    canEditBranding: boolean;
  };
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
    currentKey: menuHostKey(sections, active),
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
          data-nav-row
          className={cn(ROW, "group w-full text-[#a13a32] hover:bg-[#fff4f2]")}
        >
          <NavIconChip name="LogOut" className="size-10 rounded-xl" iconClassName="size-[22px]" />
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
        {/* Логотип компании клиента, краткое название и ИНН — над меню, как в сайдбаре. */}
        <OrganizationBrand
          logoUrl={brand.logoUrl}
          name={brand.name}
          identity={brand.identity}
          homeHref={brand.homeHref}
          canEditBranding={brand.canEditBranding}
          className="mb-2 border-b border-[#ececf4] px-2.5 pt-1 pb-4"
        />
        {shown?.menu ? (
          <>
            <BackToMainButton onClick={menu.back} />
            <SectionMenuList
              section={shown}
              activeItemId={shown.key === placeSection?.key ? menuItem?.id : undefined}
              currentKey={active}
              statuses={statuses}
              onOpenMenu={menu.openMenu}
            />
          </>
        ) : (
          <>
            {buildings.length >= 2 ? (
              <LocationSwitcherList buildings={buildings} activeBuildingId={activeBuildingId} />
            ) : null}
            <NavSectionsList sections={sections} currentKey={active} onOpenMenu={menu.openMenu} />
          </>
        )}
      </nav>
    </BottomSheet>
  );
}

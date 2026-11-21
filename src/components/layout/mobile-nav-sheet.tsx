"use client";

import type { MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { NavAccordion } from "@/components/layout/app-sidebar-accordion";
import { ClassicNavAccordion } from "@/components/layout/app-sidebar-accordion-classic";
import { useNewDesign } from "@/components/view-prefs/view-prefs-provider";
import { NavIconChip } from "@/components/layout/nav-icons";
import { OrganizationBrand } from "@/components/layout/organization-brand";
import type { SidebarOrgIdentity } from "@/lib/sidebar-org-identity";

// Строка мобильного меню: от 52px высотой, шрифт 17px, иконка 24px —
// палец попадает с первого раза.
// Строка как у разделов листа: плашка 40px слева (цвет «Выйти» — розовый).
const ROW =
  "flex min-h-[52px] items-center gap-3 rounded-2xl py-1.5 pr-3.5 pl-1.5 text-[17px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Меню на телефоне и планшете (<1024px) — листом снизу, в шаблоне «Новый»
 * (владелец, 2026-11-11): то же дерево меню, что в сайдбаре (`NavAccordion`),
 * все уровни раскрываются прямо в листе. Сверху, на месте слова «Меню», —
 * бренд организации как в сайдбаре компьютера: логотип, краткое название и
 * ИНН (владелец, 2026-11-21: «и так понимают, что это меню»). Последней
 * строкой — «Выйти»; список прокручивается внутри листа. Точку выбирают в шапке.
 */
export function MobileNavSheet({
  open,
  onClose,
  onLogout,
  brand,
}: {
  open: boolean;
  onClose: () => void;
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
  const newDesign = useNewDesign();
  const close = onClose;
  // Переход по ссылке закрывает лист (логотип ведёт на главную).
  const closeOnLink = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest("a")) close();
  };

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title={t("menu")}
      header={
        <div onClick={closeOnLink} data-mobile-nav-brand>
          <OrganizationBrand
            logoUrl={brand.logoUrl}
            name={brand.name}
            identity={brand.identity}
            homeHref={brand.homeHref}
            canEditBranding={brand.canEditBranding}
            large
          />
        </div>
      }
    >
      <nav
        data-sheet-menu="mobile"
        // Плоские иконки и строки шаблона «Новый» — те же правила, что у сайдбара.
        data-sidebar-layout="new"
        // Раскрытие раздела сюда не доходит (`NavAccordion` гасит всплытие):
        // лист закрывает только переход по ссылке.
        onClick={closeOnLink}
        className="flex flex-col gap-1 pb-1"
        data-mobile-nav
      >
        {newDesign ? <NavAccordion touch /> : <ClassicNavAccordion touch />}
        <div className="mt-2 border-t border-[#ececf4] pt-2">
          <button
            type="button"
            onClick={onLogout}
            data-nav-row
            data-nav-logout
            className={cn(ROW, "group w-full text-[#a13a32] hover:bg-[#fff4f2]")}
          >
            <NavIconChip name="LogOut" className="size-10 rounded-xl" iconClassName="size-[22px]" />
            {t("logout")}
          </button>
        </div>
      </nav>
    </BottomSheet>
  );
}

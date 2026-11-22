"use client";

import type { MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { NavAccordion } from "@/components/layout/app-sidebar-accordion";
import { ClassicNavAccordion } from "@/components/layout/app-sidebar-accordion-classic";
import { useNewDesign } from "@/components/view-prefs/view-prefs-provider";
import { BrandHeaderAction, OrganizationBrand } from "@/components/layout/organization-brand";
import type { SidebarOrgIdentity } from "@/lib/sidebar-org-identity";

/**
 * Меню на телефоне и планшете (<1024px) — листом снизу, в шаблоне «Новый»
 * (владелец, 2026-11-11): то же дерево меню, что в сайдбаре (`NavAccordion`),
 * все уровни раскрываются прямо в листе. Сверху, на месте слова «Меню», —
 * бренд организации как в сайдбаре компьютера: логотип, краткое название и
 * ИНН (владелец, 2026-11-21: «и так понимают, что это меню»). Список
 * прокручивается внутри листа, справа — видимая полоса прокрутки; внизу
 * закреплена «Пришла проверка». «Выйти» в меню больше нет (владелец,
 * 2026-11-22) — выход в листе профиля (аватар). Точку выбирают в шапке.
 */
export function MobileNavSheet({
  open,
  onClose,
  brand,
}: {
  open: boolean;
  onClose: () => void;
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
      scrollbar
      // Оформление — круглой кнопкой слева, напротив крестика, а не плашкой
      // под логотипом (владелец, 2026-11-22).
      headerStart={brand.canEditBranding ? <BrandHeaderAction logoUrl={brand.logoUrl} onNavigate={close} /> : undefined}
      header={
        <div onClick={closeOnLink} data-mobile-nav-brand>
          <OrganizationBrand
            logoUrl={brand.logoUrl}
            name={brand.name}
            identity={brand.identity}
            homeHref={brand.homeHref}
            canEditBranding={false}
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
        className="flex flex-1 flex-col gap-1"
        data-mobile-nav
      >
        {newDesign ? <NavAccordion touch /> : <ClassicNavAccordion touch />}
      </nav>
    </BottomSheet>
  );
}

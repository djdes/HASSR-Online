"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { NavAccordion } from "@/components/layout/app-sidebar-accordion";
import { NavIconChip } from "@/components/layout/nav-icons";
import { OrganizationMark } from "@/components/layout/organization-brand";
import type { SidebarOrgIdentity } from "@/lib/sidebar-org-identity";

// Строка мобильного меню: от 52px высотой, шрифт 17px, иконка 24px —
// палец попадает с первого раза.
// Строка как у разделов листа: плашка 40px слева (цвет «Выйти» — розовый).
const ROW =
  "flex min-h-[52px] items-center gap-3 rounded-2xl py-1.5 pr-3.5 pl-1.5 text-[17px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Меню на телефоне и планшете (<1024px) — листом снизу, в шаблоне «Новый»
 * (владелец, 2026-11-11): те же два уровня, что в сайдбаре (`NavAccordion`):
 * разделы, под раскрытым — его пункты; всё, что глубже, — строка над
 * страницей (`SectionTopMenu`, на телефоне прокручивается вбок). Сверху —
 * компания одной строкой, последней строкой — «Выйти»; список прокручивается
 * внутри листа. Точку выбирают в шапке.
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
  const close = onClose;

  return (
    <BottomSheet open={open} onClose={close} title={t("menu")}>
      <nav
        data-sheet-menu="mobile"
        // Плоские иконки и строки шаблона «Новый» — те же правила, что у сайдбара.
        data-sidebar-layout="new"
        onClick={(event) => {
          // Раскрытие раздела сюда не доходит (`NavAccordion` гасит всплытие):
          // лист закрывает только переход по ссылке.
          if ((event.target as HTMLElement).closest("a")) close();
        }}
        className="flex flex-col gap-1 pb-1"
        data-mobile-nav
      >
        {/* Компания — одной строкой: логотип или инициалы и название. Лист —
            про меню, а не про бренд: раньше блок с логотипом съедал треть. */}
        <Link
          href={brand.homeHref}
          className="mb-1 flex min-h-12 items-center gap-2.5 rounded-2xl px-2.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          data-mobile-nav-brand
        >
          <OrganizationMark logoUrl={brand.logoUrl} name={brand.name} />
        </Link>
        <NavAccordion touch />
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

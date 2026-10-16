"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { sectionForPath } from "@/lib/app-nav";
import type { BuildingOption } from "@/lib/building-scope";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useAppNav } from "@/components/layout/app-nav-context";
import { LocationSwitcherList } from "@/components/layout/location-switcher";
import { NavIcon } from "@/components/layout/nav-icons";

// Строка мобильного меню: от 52px высотой, шрифт 17px, иконка 24px —
// палец попадает с первого раза.
const ROW =
  "flex min-h-[52px] items-center gap-3.5 rounded-2xl px-3.5 py-3 text-[17px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Меню на телефоне и планшете (<1024px): тот же список разделов, что в
 * сайдбаре, — листом снизу. Сверху точки (если их несколько), внизу выход.
 */
export function MobileNavSheet({
  open,
  onClose,
  buildings,
  activeBuildingId,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  buildings: BuildingOption[];
  activeBuildingId: string | null;
  onLogout: () => void;
}) {
  const t = useTranslations("navigation.shell");
  const { sections } = useAppNav();
  const pathname = usePathname() || "/";
  const active = sectionForPath(pathname)?.section ?? null;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
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
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) onClose();
        }}
        className="flex flex-col gap-1"
        data-mobile-nav
      >
        {buildings.length >= 2 ? (
          <LocationSwitcherList buildings={buildings} activeBuildingId={activeBuildingId} />
        ) : null}
        {sections.map((section) => {
          const isActive = active === section.key;
          const row = (
            <Link
              key={section.key}
              href={section.rootHref}
              aria-current={isActive ? "page" : undefined}
              data-nav-section={section.key}
              className={cn(
                ROW,
                isActive ? "bg-[#f5f6ff] text-[#5566f6]" : "text-[#3c4053] hover:bg-[#fafbff]",
              )}
            >
              <NavIcon
                name={section.icon}
                className={cn("size-6 shrink-0", isActive ? "text-[#5566f6]" : "text-[#6f7282]")}
              />
              <span className="min-w-0">{section.label}</span>
            </Link>
          );
          // «Пришла проверка» — отдельно, под чертой, как в сайдбаре.
          return section.key === "inspection" ? (
            <div key={section.key} className="mt-1 border-t border-[#ececf4] pt-2">
              {row}
            </div>
          ) : (
            row
          );
        })}
      </nav>
    </BottomSheet>
  );
}

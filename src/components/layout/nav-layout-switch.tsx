"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { NAV_LAYOUTS } from "@/lib/view-prefs";
import { buildNewNav, type NewNav } from "@/lib/nav-layout";
import { cn } from "@/lib/utils";
import { useAppNav } from "@/components/layout/app-nav-context";
import { useViewPrefs } from "@/components/view-prefs/view-prefs-provider";

/**
 * Шаблон меню «Новый» включён на этом устройстве и меню у человека есть.
 * Шаблон — только для компьютера (≥1024px): всё, что он добавляет или
 * прячет, помечено `lg:`-классами, телефон остаётся прежним.
 */
export function useNewNavLayout(): boolean {
  const { prefs } = useViewPrefs();
  const { showSidebar } = useAppNav();
  return showSidebar && prefs.navLayout === "new";
}

/** Где человек в шаблоне «Новый»: один расчёт на сайдбар, строку и крошки. */
export function useNewNavPlace(): NewNav {
  const { sections } = useAppNav();
  const pathname = usePathname() || "/";
  return useMemo(() => buildNewNav(sections, pathname), [sections, pathname]);
}

/**
 * «Вид меню: Стандартный / Новый» — внизу меню слева, в обоих шаблонах:
 * включить новый и вернуться к стандартному — одно нажатие. Выбор — настройка
 * устройства (кука `wesetup-view`), меняется сразу, без перезагрузки.
 */
export function NavLayoutSwitch() {
  const t = useTranslations("navigation.shell.navLayout");
  const { prefs, update } = useViewPrefs();
  return (
    <div className="shrink-0 border-t border-[#ececf4] px-3 py-3" data-nav-layout-switch>
      <div id="nav-layout-label" className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#6f7282]">
        {t("label")}
      </div>
      <div role="group" aria-labelledby="nav-layout-label" className="grid grid-cols-2 gap-1 rounded-xl bg-[#f4f5fb] p-1">
        {NAV_LAYOUTS.map((layout) => {
          const checked = prefs.navLayout === layout;
          return (
            <button
              key={layout}
              type="button"
              aria-pressed={checked}
              data-nav-layout={layout}
              onClick={() => update({ navLayout: layout })}
              className={cn(
                "h-9 rounded-lg px-2 text-[13px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                checked
                  ? "bg-white text-[#3848c7] shadow-[0_1px_2px_rgba(11,16,36,0.08)]"
                  : "text-[#6f7282] hover:text-[#0b1024]",
              )}
            >
              {t(layout)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

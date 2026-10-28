"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { mainNavSections, sectionForPath, type NavSectionKey } from "@/lib/app-nav";
import type { NavModelMenuItem, NavModelSection } from "@/lib/app-nav.server";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand/logo";
import { useAppNav } from "@/components/layout/app-nav-context";
import { NavIcon } from "@/components/layout/nav-icons";
import { OrganizationBrand } from "@/components/layout/organization-brand";
import {
  NavBadge,
  NavChevron,
  menuHostKey,
  sectionChain,
  topSectionKey,
} from "@/components/layout/section-menu-list";
import { SectionStatusDot } from "@/components/layout/section-status-dot";
import { useSectionPlace } from "@/components/layout/section-tabs";
import { useSectionStatuses } from "@/components/layout/use-section-statuses";
import type { SidebarOrgIdentity } from "@/lib/sidebar-org-identity";


const SIDEBAR_ITEM =
  "flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2 text-[14.5px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Меню кабинета слева (≥1024px): по центру логотип компании (нет — заглушка,
 * руководителю — кнопка «Загрузить логотип»), под ним краткое название и ИНН,
 * ниже разделы. «Пришла проверка» прижата к низу — в спешке её
 * ищут глазами первой; это отдельное действие (контурная кнопка), а не
 * выбранный пункт. У разделов со своим меню — стрелка ›.
 *
 * У раздела своё меню (`section.menu`): при входе в раздел левое меню
 * меняется целиком. Разделы вложены (эскизы 2026-10-28: «Моя компания →
 * Торговые точки → Журналы»): пункт-раздел со стрелкой открывает меню
 * вложенного раздела, «‹ Назад» поднимает на уровень вверх — в меню родителя,
 * из раздела главного меню — в главное меню; страница при этом не меняется.
 * Две панели лежат на ленте шириной 200%: главное меню и меню раздела, вход и
 * выход из главного меню — сдвиг ленты. Раздел без меню («Остальное») —
 * пункт меню родителя.
 */
export function AppSidebar({
  logoUrl,
  organizationName,
  identity,
  homeHref,
  canEditBranding = false,
  whiteLabel = false,
}: {
  logoUrl: string | null;
  organizationName: string;
  /** Под логотипом: краткое название и ИНН (эскиз: «Юр. наименование (сокр.)»). */
  identity: SidebarOrgIdentity;
  homeHref: string;
  canEditBranding?: boolean;
  /** White-label партнёра: отметку «сетап» внизу не ставим. */
  whiteLabel?: boolean;
}) {
  const t = useTranslations("navigation.shell");
  const { sections } = useAppNav();
  const pathname = usePathname() || "/";
  const { section: placeSection, menuItem } = useSectionPlace();
  const current = sectionForPath(pathname)?.section ?? null;
  const top = topSectionKey(sections, current);
  const hostKey = menuHostKey(sections, current);
  const inside = new Set(sectionChain(sections, current).map((section) => section.key));
  const mainSections = mainNavSections(sections);
  const main = mainSections.filter((section) => section.key !== "inspection");
  const inspection = mainSections.find((section) => section.key === "inspection");

  // Какое меню показано, помним вместе с путём: при смене пути снова видно
  // меню текущего раздела (`hostKey`).
  const [view, setView] = useState<{ path: string; key: NavSectionKey | "main" } | null>(null);
  const viewKey = view && view.path === pathname ? view.key : (hostKey ?? "main");
  const viewSection = viewKey === "main" ? undefined : sections.find((section) => section.key === viewKey && section.menu);
  const showSection = Boolean(viewSection);

  // Панель раздела рисуется заранее, чтобы вход и выход были сдвигом ленты.
  // В главном меню в ней — последний показанный раздел: за 200 мс сдвига не
  // мелькает меню чужого раздела.
  const [lastMenuKey, setLastMenuKey] = useState<NavSectionKey | null>(viewSection?.key ?? null);
  if (viewSection && viewSection.key !== lastMenuKey) setLastMenuKey(viewSection.key);
  const menuSection: NavModelSection | undefined =
    viewSection ??
    sections.find((section) => section.key === lastMenuKey && section.menu) ??
    sections.find((section) => section.menu);
  const statuses = useSectionStatuses(showSection ? menuSection?.key : undefined);

  // Фокус не должен пропадать, когда панель становится inert: после
  // «‹ Назад» — на пункт раздела, из которого вышли, при входе в меню
  // раздела — на «‹ Назад». Переносим только после действия человека.
  const asideRef = useRef<HTMLElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<NavSectionKey | "back" | null>(null);
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    if (target === "back") backRef.current?.focus();
    else
      asideRef.current
        ?.querySelector<HTMLElement>(`[data-nav-section="${target}"], [data-menu-section="${target}"]`)
        ?.focus();
  }, [viewKey]);

  const openMenu = (key: NavSectionKey) => {
    focusAfter.current = "back";
    setView({ path: pathname, key });
  };
  const goBack = () => {
    const parent = viewSection?.parent;
    const parentHasMenu = parent ? sections.some((section) => section.key === parent && section.menu) : false;
    focusAfter.current = viewSection?.key ?? null;
    setView({ path: pathname, key: parent && parentHasMenu ? parent : "main" });
  };

  // Раздел со своим меню, внутри которого человек уже стоит, не уводит на
  // корень: только открывает своё меню. Иначе — обычный переход на корень,
  // меню откроется само (по пути).
  const selectHandler = (key: NavSectionKey, hasMenu: boolean) =>
    hasMenu
      ? (event: MouseEvent<HTMLAnchorElement>) => {
          if (inside.has(key)) {
            event.preventDefault();
            openMenu(key);
          } else {
            setView(null);
          }
        }
      : undefined;

  const logo = (
    <div className="shrink-0 border-b border-[#ececf4] px-5 pt-5 pb-4" data-sidebar-logo>
      <OrganizationBrand
        logoUrl={logoUrl}
        name={organizationName}
        identity={identity}
        homeHref={homeHref}
        canEditBranding={canEditBranding}
        large
      />
    </div>
  );

  // Маленькая отметка «сетап» внизу (решение по эскизам: логотип клиента
  // сверху, наш знак — тихо снизу).
  const brandMark = whiteLabel ? null : (
    <div className="shrink-0 px-5 pt-2 pb-4 text-[#b4b8c8]" data-sidebar-brand-mark>
      <BrandLogo height={12} title={t("brand")} />
    </div>
  );

  const mainPane = (
    <>
      {logo}
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {main.map((section) => (
            <SidebarItem
              key={section.key}
              section={section}
              active={top === section.key}
              onSelect={selectHandler(section.key, Boolean(section.menu))}
            />
          ))}
        </div>
        {inspection ? (
          <div className="mt-auto border-t border-[#ececf4] pt-3">
            <SidebarItem
              section={inspection}
              active={top === "inspection"}
              action
              onSelect={selectHandler("inspection", Boolean(inspection.menu))}
            />
          </div>
        ) : null}
      </nav>
      {brandMark}
    </>
  );

  if (!menuSection?.menu) {
    return (
      <aside
        data-app-sidebar
        aria-label={t("sidebarAria")}
        className="sticky top-0 z-20 hidden h-screen w-[256px] shrink-0 flex-col border-r border-[#ececf4] bg-white lg:flex print:hidden"
      >
        {mainPane}
      </aside>
    );
  }

  const menuItemActive = (item: NavModelMenuItem) =>
    item.section ? inside.has(item.section) : menuSection.key === placeSection?.key && menuItem?.id === item.id;

  return (
    <aside
      ref={asideRef}
      data-app-sidebar
      data-sidebar-mode={showSection ? "section" : "main"}
      data-sidebar-section={showSection ? menuSection.key : undefined}
      aria-label={t("sidebarAria")}
      className="sticky top-0 z-20 hidden h-screen w-[256px] shrink-0 overflow-hidden border-r border-[#ececf4] bg-white lg:block print:hidden"
    >
      <div
        className={cn(
          "flex h-full w-[200%] transition-transform duration-200 motion-reduce:transition-none",
          showSection ? "-translate-x-1/2" : "translate-x-0",
        )}
      >
        <div className="flex h-full w-1/2 shrink-0 flex-col" inert={showSection} aria-hidden={showSection}>
          {mainPane}
        </div>
        <div className="flex h-full w-1/2 shrink-0 flex-col" inert={!showSection} aria-hidden={!showSection}>
          {logo}
          <div className="shrink-0 px-3 pt-3">
            <button
              ref={backRef}
              type="button"
              onClick={goBack}
              data-back-to-main
              className="inline-flex h-9 items-center gap-1 rounded-xl px-2.5 text-[13.5px] font-semibold text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <ChevronLeft className="size-4" aria-hidden />
              {t("back")}
            </button>
          </div>
          <Link
            href={menuSection.rootHref}
            className="mx-3 mt-1 shrink-0 rounded-xl px-2.5 pt-2.5 pb-1.5 text-[15px] font-semibold text-[#0b1024] transition-colors duration-150 hover:text-[#3848c7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            {menuSection.label}
          </Link>
          <nav
            aria-label={t("sectionMenuAria")}
            data-section-menu={menuSection.key}
            className="min-h-0 flex-1 overflow-y-auto px-3 pb-4"
          >
            {menuSection.menu.map((group, index) => (
              <div key={group.label ?? `group-${index}`}>
                {group.label ? (
                  <div className="px-2.5 pt-3 pb-1 text-[12px] font-semibold text-[#9b9fb3]">{group.label}</div>
                ) : null}
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const isActive = menuItemActive(item);
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        onClick={item.section ? selectHandler(item.section, Boolean(item.hasMenu)) : undefined}
                        aria-current={isActive ? (item.section ? "true" : "page") : undefined}
                        data-menu-item={item.id}
                        data-menu-section={item.section}
                        className={cn(
                          SIDEBAR_ITEM,
                          "group",
                          isActive
                            ? "bg-[#5566f6]/[0.09] text-[#5566f6]"
                            : "text-[#3c4053] hover:bg-[#f5f6ff] hover:text-[#0b1024]",
                        )}
                      >
                        <NavIcon
                          name={item.icon}
                          className={cn("size-5 shrink-0", isActive ? "text-[#5566f6]" : "text-[#6f7282]")}
                        />
                        <span className="min-w-0 flex-1">{item.label}</span>
                        {item.badge ? <NavBadge>{item.badge}</NavBadge> : null}
                        <SectionStatusDot status={statuses[item.id]} />
                        {item.hasMenu ? <NavChevron active={isActive} /> : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          {brandMark}
        </div>
      </div>
    </aside>
  );
}

/**
 * Пункт главного меню. У раздела со своим меню — постоянная стрелка ›
 * (руководитель: «все меню, которые разворачиваются, должны быть со
 * стрелочкой»).
 *
 * `action` — «Пришла проверка» внизу: отдельное действие, а не выбранный
 * пункт, поэтому в покое это контурная кнопка (белая, с рамкой и индиго-
 * текстом), а заливка — только когда раздел открыт, как у остальных пунктов.
 */
function SidebarItem({
  section,
  active,
  action = false,
  onSelect,
}: {
  section: NavModelSection;
  active: boolean;
  action?: boolean;
  onSelect?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href={section.rootHref}
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      data-nav-section={section.key}
      data-nav-action={action ? "" : undefined}
      className={cn(
        SIDEBAR_ITEM,
        "group",
        action
          ? active
            ? "border border-[#5566f6]/25 bg-[#5566f6]/[0.09] text-[#5566f6]"
            : "border border-[#dcdfed] bg-white text-[#3848c7] shadow-[0_1px_2px_rgba(11,16,36,0.04)] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          : active
            ? "bg-[#5566f6]/[0.09] text-[#5566f6]"
            : "text-[#3c4053] hover:bg-[#f5f6ff] hover:text-[#0b1024]",
      )}
    >
      <NavIcon
        name={section.icon}
        className={cn("size-5 shrink-0", active || action ? "text-[#5566f6]" : "text-[#6f7282]")}
      />
      <span className="min-w-0 flex-1">{section.label}</span>
      {section.menu ? <NavChevron active={active} /> : null}
    </Link>
  );
}

"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { sectionForPath, type NavSectionKey } from "@/lib/app-nav";
import type { NavModelSection } from "@/lib/app-nav.server";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand/logo";
import { useAppNav } from "@/components/layout/app-nav-context";
import { NavIcon } from "@/components/layout/nav-icons";
import { OrganizationBrand } from "@/components/layout/organization-brand";
import { SectionStatusDot } from "@/components/layout/section-status-dot";
import { useSectionPlace } from "@/components/layout/section-tabs";
import { useSectionStatuses } from "@/components/layout/use-section-statuses";


const SIDEBAR_ITEM =
  "flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2 text-[14.5px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Меню кабинета слева (≥1024px): логотип компании и разделы. «Пришла
 * проверка» прижата к низу — в спешке её ищут глазами первой.
 *
 * У раздела своё меню (`section.menu`, эскизы руководителя 2026-10-17): при
 * входе в раздел левое меню меняется целиком. Две панели лежат на ленте
 * шириной 200%, при входе лента сдвигается на панель раздела (логотип,
 * «‹ Главное меню», заголовок раздела и его пункты), а «‹ Главное меню»
 * возвращает обычный список, не меняя страницу. Раздел без меню
 * («Остальное») — обычный список, подразделы — вкладки над основным окном.
 */
export function AppSidebar({
  logoUrl,
  organizationName,
  homeHref,
  canEditBranding = false,
  whiteLabel = false,
}: {
  logoUrl: string | null;
  organizationName: string;
  homeHref: string;
  canEditBranding?: boolean;
  /** White-label партнёра: отметку «сетап» внизу не ставим. */
  whiteLabel?: boolean;
}) {
  const t = useTranslations("navigation.shell");
  const { sections } = useAppNav();
  const pathname = usePathname() || "/";
  const { section: placeSection, menuItem } = useSectionPlace();
  const active = sectionForPath(pathname)?.section ?? null;
  const main = sections.filter((section) => section.key !== "inspection");
  const inspection = sections.find((section) => section.key === "inspection");

  // Панель раздела рисуется заранее, чтобы вход и выход были сдвигом ленты.
  // Вне раздела с меню в ней — последний открытый раздел с меню: при уходе в
  // «Остальное» за 200 мс сдвига не мелькает меню чужого раздела.
  const [lastMenuKey, setLastMenuKey] = useState<NavSectionKey | null>(
    placeSection?.menu ? placeSection.key : null,
  );
  if (placeSection?.menu && placeSection.key !== lastMenuKey) setLastMenuKey(placeSection.key);
  const menuSection: NavModelSection | undefined = placeSection?.menu
    ? placeSection
    : (sections.find((section) => section.key === lastMenuKey && section.menu) ??
      sections.find((section) => section.menu));
  const inSection = Boolean(placeSection?.menu);
  // «Показано главное меню» помним вместе с путём: при смене пути оно само сбрасывается.
  const [mainShownFor, setMainShownFor] = useState<string | null>(null);
  const showSection = inSection && mainShownFor !== pathname;
  const statuses = useSectionStatuses(inSection ? menuSection?.key : undefined);

  // Фокус не должен пропадать, когда панель становится inert: после
  // «‹ Главное меню» — на пункт текущего раздела, при возврате в меню раздела —
  // на «‹ Главное меню». Переносим только после действия человека.
  const asideRef = useRef<HTMLElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef(false);
  useEffect(() => {
    if (!focusAfter.current) return;
    focusAfter.current = false;
    if (showSection) backRef.current?.focus();
    else if (active) asideRef.current?.querySelector<HTMLElement>(`[data-nav-section="${active}"]`)?.focus();
  }, [showSection, active]);

  // Пункт раздела с меню возвращает его панель, даже если путь не меняется:
  // уже внутри раздела — не уводим на его корень, только возвращаем панель.
  const selectHandler = (section: NavModelSection) =>
    section.menu
      ? (event: MouseEvent<HTMLAnchorElement>) => {
          if (inSection && active === section.key) {
            event.preventDefault();
            focusAfter.current = true;
          }
          setMainShownFor(null);
        }
      : undefined;

  const logo = (
    <div className="flex h-[72px] shrink-0 items-center border-b border-[#ececf4] px-5" data-sidebar-logo>
      <OrganizationBrand
        logoUrl={logoUrl}
        name={organizationName}
        homeHref={homeHref}
        canEditBranding={canEditBranding}
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
              active={active === section.key}
              onSelect={selectHandler(section)}
              chevron={Boolean(section.menu) && active === section.key}
            />
          ))}
        </div>
        {inspection ? (
          <div className="mt-auto border-t border-[#ececf4] pt-3">
            <SidebarItem
              section={inspection}
              active={active === "inspection"}
              accent
              onSelect={selectHandler(inspection)}
              chevron={Boolean(inspection.menu) && active === "inspection"}
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

  return (
    <aside
      ref={asideRef}
      data-app-sidebar
      data-sidebar-mode={showSection ? "section" : "main"}
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
              onClick={() => {
                focusAfter.current = true;
                setMainShownFor(pathname);
              }}
              data-back-to-main
              className="inline-flex h-9 items-center gap-1 rounded-xl px-2.5 text-[13.5px] font-semibold text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <ChevronLeft className="size-4" aria-hidden />
              {t("backToMain")}
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
                    const isActive = inSection && menuItem?.id === item.id;
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        data-menu-item={item.id}
                        className={cn(
                          SIDEBAR_ITEM,
                          isActive
                            ? "bg-[#5566f6]/[0.09] text-[#5566f6]"
                            : "text-[#3c4053] hover:bg-[#f5f6ff] hover:text-[#0b1024]",
                        )}
                      >
                        <NavIcon
                          name={item.icon}
                          className={cn("size-5 shrink-0", isActive ? "text-[#5566f6]" : "text-[#6f7282]")}
                        />
                        <span className="min-w-0">{item.label}</span>
                        <SectionStatusDot status={statuses[item.id]} />
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

function SidebarItem({
  section,
  active,
  accent = false,
  chevron = false,
  onSelect,
}: {
  section: NavModelSection;
  active: boolean;
  accent?: boolean;
  chevron?: boolean;
  onSelect?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href={section.rootHref}
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      data-nav-section={section.key}
      className={cn(
        SIDEBAR_ITEM,
        active
          ? "bg-[#5566f6]/[0.09] text-[#5566f6]"
          : accent
            ? "bg-[#f5f6ff] text-[#3848c7] hover:bg-[#eef1ff]"
            : "text-[#3c4053] hover:bg-[#f5f6ff] hover:text-[#0b1024]",
      )}
    >
      <NavIcon
        name={section.icon}
        className={cn("size-5 shrink-0", active || accent ? "text-[#5566f6]" : "text-[#6f7282]")}
      />
      <span className="min-w-0 flex-1">{section.label}</span>
      {chevron ? <ChevronRight className="size-4 shrink-0 text-[#5566f6]" aria-hidden /> : null}
    </Link>
  );
}

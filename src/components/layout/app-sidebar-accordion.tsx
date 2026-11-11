"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { mainNavSections, navSectionPath, sectionForPath, type NavSectionKey } from "@/lib/app-nav";
import type { NavModelMenuItem, NavModelSection } from "@/lib/app-nav.server";
import { cn } from "@/lib/utils";
import { useAppNav } from "@/components/layout/app-nav-context";
import { useNewNavPlace } from "@/components/layout/nav-layout-switch";
import { sectionEntryHref } from "@/lib/nav-layout";
import { OrganizationBrand } from "@/components/layout/organization-brand";
import { NavBadge } from "@/components/layout/section-menu-list";
import type { SidebarOrgIdentity } from "@/lib/sidebar-org-identity";

// Дерево меню (владелец, 2026-11-11: «меню как в документации, без иконок,
// чуть крупнее»): строки без плашек, уровни — отступом слева, стрелка
// раскрытия справа. Выбран только лист — мягкая заливка бренда.
const TREE_ROW =
  "relative flex min-h-11 items-center justify-between gap-2 rounded-[10px] py-2 pr-3 text-[16px] leading-snug transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";
const TREE_ROW_TOUCH = "min-h-[52px] text-[16.5px]";
const TREE_IDLE = "text-[#2a2c3a] hover:bg-[#f1f1f5] hover:text-[#0b1024]";
const TREE_IDLE_DEEP = "text-[#4a4d5e] hover:bg-[#f1f1f5] hover:text-[#0b1024]";
const TREE_ACTIVE = "bg-[#eef0fe] font-medium text-[#3343cf]";
/** Отступ строки по уровню: 14px у раздела, +22px на каждый уровень. */
const indent = (depth: number) => ({ paddingLeft: `${14 + (depth - 1) * 22}px` });

function TreeChevron({ open }: { open: boolean }) {
  return (
    <ChevronDown
      aria-hidden
      className={cn(
        "size-4 shrink-0 text-[#8a8d9c] transition-transform duration-150 motion-reduce:transition-none",
        open ? "" : "-rotate-90",
      )}
    />
  );
}

/**
 * Меню деревом — общее для сайдбара на компьютере и листа меню на телефоне
 * (`touch` — строки выше, под палец). Уровни: раздел главного меню → его
 * пункты → пункты вложенного раздела (или вкладки пункта) → следующий
 * вложенный раздел. Раскрыта ветка текущей страницы; раздел главного меню
 * можно свернуть и раскрыть нажатием.
 */
export function NavAccordion({ touch = false }: { touch?: boolean }) {
  const { sections } = useAppNav();
  const pathname = usePathname() || "/";
  const place = useNewNavPlace();
  const mainSections = mainNavSections(sections);
  const main = mainSections.filter((section) => section.key !== "inspection");
  const inspection = mainSections.find((section) => section.key === "inspection");

  const owner = sectionForPath(pathname);
  const chainKeys = new Set(owner ? navSectionPath(sections, owner.section).map((section) => section.key) : []);
  const cleanPath = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const tabHref = owner?.menuTabHref ?? cleanPath;
  const byKey = new Map(sections.map((section) => [section.key, section]));

  const [manual, setManual] = useState<{ path: string; key: NavSectionKey | null } | null>(null);
  if (manual && manual.path !== pathname) setManual(null);
  const openKey = manual ? manual.key : place.top;

  const onSection = (section: NavModelSection) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!section.menu) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (openKey === section.key) {
      event.preventDefault();
      event.stopPropagation();
      setManual({ path: pathname, key: null });
    } else if (touch || place.top === section.key) {
      event.preventDefault();
      event.stopPropagation();
      setManual({ path: pathname, key: section.key });
    } else {
      setManual({ path: pathname, key: section.key });
    }
  };

  const renderItems = (section: NavModelSection, depth: number): ReactNode =>
    section.menu?.map((group, index) => (
      <div key={group.label ?? `group-${index}`} className="space-y-0.5">
        {group.label ? (
          <div
            style={indent(depth)}
            className="pt-2.5 pb-1 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[#7a7d8c]"
          >
            {group.label}
          </div>
        ) : null}
        {group.items.map((item) => renderItem(section, item, depth))}
      </div>
    ));

  const renderItem = (section: NavModelSection, item: NavModelMenuItem, depth: number): ReactNode => {
    const child = item.section ? byKey.get(item.section) : undefined;
    const isCurrentItem = owner?.section === section.key && owner?.menuItemId === item.id && !item.section;
    const tabs = !child && item.tabs && item.tabs.length > 1 ? item.tabs : [];
    const hasKids = Boolean(child?.menu) || tabs.length > 0;
    const open = child ? chainKeys.has(child.key) : isCurrentItem && tabs.length > 0;
    // Корень вложенного раздела (своего пункта у страницы нет) — выбран сам раздел.
    const atChildRoot =
      Boolean(child) &&
      owner?.section === child?.key &&
      !child?.menu?.some((group) => group.items.some((entry) => entry.id === owner?.menuItemId));
    const active = (isCurrentItem && tabs.length === 0) || atChildRoot;
    return (
      <div key={item.id}>
        <Link
          href={item.href}
          aria-current={active ? "page" : open ? "true" : undefined}
          aria-expanded={hasKids ? open : undefined}
          data-menu-item={item.id}
          data-menu-section={item.section}
          data-nav-tree-row
          data-active={active ? "" : undefined}
          style={indent(depth)}
          className={cn(TREE_ROW, touch && TREE_ROW_TOUCH, "text-[15.5px]", active ? TREE_ACTIVE : TREE_IDLE_DEEP)}
        >
          <span className="min-w-0 flex-1">{item.label}</span>
          {item.badge ? <NavBadge>{item.badge}</NavBadge> : null}
          {hasKids ? <TreeChevron open={open} /> : null}
        </Link>
        {open && child ? <div className="mt-0.5 space-y-0.5">{renderItems(child, depth + 1)}</div> : null}
        {open && tabs.length > 0 ? (
          <div className="mt-0.5 space-y-0.5">
            {tabs.map((tab) => {
              const tabActive = tab.href === tabHref;
              return (
                <Link
                  key={tab.id}
                  href={tab.href}
                  aria-current={tabActive ? "page" : undefined}
                  data-nav-tree-row
                  data-active={tabActive ? "" : undefined}
                  style={indent(depth + 1)}
                  className={cn(TREE_ROW, touch && TREE_ROW_TOUCH, "text-[15px]", tabActive ? TREE_ACTIVE : TREE_IDLE_DEEP)}
                >
                  <span className="min-w-0 flex-1">{tab.label}</span>
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  const renderSection = (section: NavModelSection, action = false) => {
    const inside = place.top === section.key;
    const open = Boolean(section.menu) && openKey === section.key;
    const active = inside && !section.menu;
    return (
      <div key={section.key}>
        <Link
          href={sectionEntryHref(section)}
          onClick={onSection(section)}
          aria-current={inside ? (section.menu ? "true" : "page") : undefined}
          aria-expanded={section.menu ? open : undefined}
          data-nav-section={section.key}
          data-nav-action={action ? "" : undefined}
          data-nav-tree-row
          data-active={active ? "" : undefined}
          style={indent(1)}
          className={cn(
            TREE_ROW,
            touch && TREE_ROW_TOUCH,
            "font-medium",
            action && !active
              ? "border border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#f5f6ff]"
              : active
                ? TREE_ACTIVE
                : TREE_IDLE,
          )}
        >
          <span className="min-w-0 flex-1">{section.label}</span>
          {section.menu ? <TreeChevron open={open} /> : null}
        </Link>
        {open && section.menu ? (
          <div data-nav-sublist={section.key} className="mt-0.5 mb-1.5 space-y-0.5">
            {renderItems(section, 2)}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <div className="space-y-0.5">{main.map((section) => renderSection(section))}</div>
      {inspection ? (
        <div className={touch ? "pt-3" : "mt-auto pt-3"}>
          <div className="border-t border-[#ececf4] pt-3">{renderSection(inspection, true)}</div>
        </div>
      ) : null}
    </>
  );
}

/**
 * Меню слева в шаблоне «Новый»: белая карточка на сером фоне страницы, в
 * ней логотип и дерево меню (`NavAccordion`) до четырёх уровней, без иконок
 * (владелец, 2026-11-11). Внизу — «Пришла проверка».
 */
export function AppSidebarAccordion({
  logoUrl,
  organizationName,
  identity,
  homeHref,
  canEditBranding = false,
}: {
  logoUrl: string | null;
  organizationName: string;
  identity: SidebarOrgIdentity;
  homeHref: string;
  canEditBranding?: boolean;
}) {
  const t = useTranslations("navigation.shell");
  return (
    <aside
      data-app-sidebar
      data-sidebar-layout="new"
      aria-label={t("sidebarAria")}
      className="sticky top-0 z-20 hidden h-screen w-[300px] shrink-0 p-3 pr-0 lg:flex print:hidden"
    >
      <div className="flex min-h-0 w-full flex-col rounded-2xl border border-[#eeeef2] bg-white shadow-[0_1px_3px_rgba(17,17,20,0.04)]">
        <div className="shrink-0 border-b border-[#eeeef2] px-5 pt-5 pb-4" data-sidebar-logo>
          <OrganizationBrand
            logoUrl={logoUrl}
            name={organizationName}
            identity={identity}
            homeHref={homeHref}
            canEditBranding={canEditBranding}
            large
          />
        </div>
        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
          <NavAccordion />
        </nav>
      </div>
    </aside>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, PanelLeftClose, PanelLeftOpen, ShieldAlert } from "lucide-react";
import { mainNavSections, navSectionPath, sectionForPath, type NavSectionKey } from "@/lib/app-nav";
import type { NavModelMenuItem, NavModelSection } from "@/lib/app-nav.server";
import { cn } from "@/lib/utils";
import { useAppNav } from "@/components/layout/app-nav-context";
import { useNewNavPlace } from "@/components/layout/nav-layout-switch";
import { sectionEntryHref } from "@/lib/nav-layout";
import { OrganizationBrand } from "@/components/layout/organization-brand";
import { NavBadge } from "@/components/layout/section-menu-list";
import { NavIcon } from "@/components/layout/nav-icons";
import type { SidebarOrgIdentity } from "@/lib/sidebar-org-identity";

// Дерево меню (владелец, 2026-11-11: «меню как в документации, чуть
// крупнее»): строки без плашек, уровни — отступом слева, тусклая маленькая
// стрелка раскрытия справа. На первых двух уровнях — тонкая серая иконка.
// Выбран только лист — мягкая заливка бренда.
const TREE_ROW =
  "relative flex min-h-11 items-center justify-between gap-2 rounded-[10px] py-2 pr-3 text-[16px] leading-snug transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";
const TREE_ROW_TOUCH = "min-h-[52px] text-[16.5px]";
const TREE_IDLE = "text-[#2a2c3a] hover:bg-[#f1f1f5] hover:text-[#0b1024]";
const TREE_IDLE_DEEP = "text-[#4a4d5e] hover:bg-[#f1f1f5] hover:text-[#0b1024]";
const TREE_ACTIVE = "bg-[#eef0fe] font-medium text-[#3343cf]";
/**
 * Отступ строки по уровню: 14px у раздела, 36px у второго уровня; с третьего
 * иконок нет — текст встаёт под текст родителя (62px), дальше +18px.
 */
const indent = (depth: number) => ({ paddingLeft: `${depth <= 2 ? 14 + (depth - 1) * 22 : 62 + (depth - 3) * 18}px` });

function TreeChevron({ open }: { open: boolean }) {
  return (
    <ChevronDown
      aria-hidden
      className={cn(
        "size-3.5 shrink-0 stroke-[1.75] text-[#b6b8c4] transition-transform duration-150 motion-reduce:transition-none",
        open ? "" : "-rotate-90",
      )}
    />
  );
}

/** Тонкая иконка строки (уровни 1–2): серая, у выбранной — цвет бренда. */
function TreeIcon({ name, active }: { name: string; active: boolean }) {
  return (
    <NavIcon
      name={name}
      className={cn("size-[18px] shrink-0 stroke-[1.6]", active ? "text-[#3343cf]" : "text-[#7a7d8c]")}
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
export function NavAccordion({
  touch = false,
  inspectionInline = true,
}: {
  touch?: boolean;
  /** «Пришла проверка» в конце списка; `false` — её рисует сайдбар внизу (`NavInspection`). */
  inspectionInline?: boolean;
}) {
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
          {depth <= 2 ? <TreeIcon name={item.icon} active={active} /> : null}
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
              ? "border border-[#111114] bg-white text-[#111114] hover:bg-[#f1f1f4]"
              : active
                ? TREE_ACTIVE
                : TREE_IDLE,
          )}
        >
          <TreeIcon name={section.icon} active={active} />
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
      {inspection && inspectionInline ? (
        <div className={touch ? "pt-3" : "mt-auto pt-3"}>
          <div className="border-t border-[#ececf4] pt-3">{renderSection(inspection, true)}</div>
        </div>
      ) : null}
    </>
  );
}

const SIDEBAR_COLLAPSED_KEY = "wesetup-sidebar-collapsed";

/** Свёрнуто ли меню слева; помним на устройстве (localStorage). */
function useSidebarCollapsed(): [boolean, (value: boolean) => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- чтение выбора устройства после гидрации
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      /* storage blocked */
    }
  }, []);
  const update = useCallback((value: boolean) => {
    setCollapsed(value);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? "1" : "0");
    } catch {
      /* storage blocked */
    }
  }, []);
  return [collapsed, update];
}

/**
 * Прокрутка меню внутри карточки. Когда список длиннее карточки, сверху и
 * снизу появляются круглые кнопки со стрелкой — прокрутить на экран.
 */
function SidebarScroll({ children }: { children: ReactNode }) {
  const t = useTranslations("navigation.shell");
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ up: false, down: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const up = el.scrollTop > 4;
      const down = el.scrollTop + el.clientHeight < el.scrollHeight - 4;
      setEdges((prev) => (prev.up === up && prev.down === down ? prev : { up, down }));
    };
    // Выбранный пункт сразу на виду: длинное меню прокручено к нему.
    const active = el.querySelector<HTMLElement>("[data-active]");
    if (active && active.offsetTop + active.offsetHeight > el.clientHeight) {
      el.scrollTop = active.offsetTop - el.clientHeight / 2;
    }
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  const scrollBy = (direction: 1 | -1) => () => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ top: direction * Math.max(160, el.clientHeight - 120), behavior: "smooth" });
  };

  const arrow =
    "absolute left-1/2 z-10 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-[#dcdde3] bg-white text-[#5f6170] shadow-[0_2px_6px_rgba(17,17,20,0.08)] transition-colors hover:bg-[#f1f1f4] hover:text-[#111114] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/10";

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} className="relative h-full overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="space-y-0.5">{children}</div>
      </div>
      {edges.up ? (
        <button type="button" aria-label={t("scrollUp")} onClick={scrollBy(-1)} className={cn(arrow, "top-2")}>
          <ChevronUp className="size-4" aria-hidden />
        </button>
      ) : null}
      {edges.down ? (
        <button type="button" aria-label={t("scrollDown")} onClick={scrollBy(1)} className={cn(arrow, "bottom-2")}>
          <ChevronDown className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/**
 * «Пришла проверка» — всегда внизу меню, одной строкой: в спешке её ищут
 * глазами первой. Контурная тёмная кнопка, а не пункт списка.
 */
function NavInspection({ compact = false }: { compact?: boolean }) {
  const { sections } = useAppNav();
  const place = useNewNavPlace();
  const inspection = mainNavSections(sections).find((section) => section.key === "inspection");
  if (!inspection) return null;
  const active = place.top === inspection.key;
  return (
    <Link
      href={sectionEntryHref(inspection)}
      aria-current={active ? "page" : undefined}
      title={compact ? inspection.label : undefined}
      aria-label={compact ? inspection.label : undefined}
      data-nav-section={inspection.key}
      data-nav-action=""
      className={cn(
        "flex h-11 items-center justify-center gap-2 rounded-[10px] border border-[#111114] text-[15px] font-medium whitespace-nowrap text-[#111114] transition-colors duration-150 hover:bg-[#f1f1f4] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/10",
        compact ? "w-11" : "w-full px-3",
        active ? "bg-[#ececef]" : "bg-white",
      )}
    >
      <ShieldAlert className="size-[18px] shrink-0 stroke-[1.6]" aria-hidden />
      {compact ? null : <span className="truncate">{inspection.label}</span>}
    </Link>
  );
}

/** Свёрнутое меню: узкая полоса с иконками разделов главного меню. */
function CollapsedRail({ onExpand }: { onExpand: () => void }) {
  const t = useTranslations("navigation.shell");
  const { sections } = useAppNav();
  const place = useNewNavPlace();
  const main = mainNavSections(sections).filter((section) => section.key !== "inspection");
  return (
    <div className="flex min-h-0 w-full flex-col items-center gap-1 rounded-2xl border border-[#eeeef2] bg-white py-3 shadow-[0_1px_3px_rgba(17,17,20,0.04)]">
      <button
        type="button"
        onClick={onExpand}
        aria-label={t("expandMenu")}
        title={t("expandMenu")}
        className="mb-2 flex size-10 items-center justify-center rounded-[10px] text-[#5f6170] transition-colors hover:bg-[#f1f1f4] hover:text-[#111114] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/10"
      >
        <PanelLeftOpen className="size-5 stroke-[1.6]" aria-hidden />
      </button>
      <nav aria-label={t("sidebarAria")} className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto [scrollbar-width:none]">
        {main.map((section) => {
          const active = place.top === section.key;
          return (
            <Link
              key={section.key}
              href={sectionEntryHref(section)}
              title={section.label}
              aria-label={section.label}
              aria-current={active ? "true" : undefined}
              data-nav-section={section.key}
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-[10px] transition-colors hover:bg-[#f1f1f4]",
                active ? "bg-[#eef0fe] text-[#3343cf]" : "text-[#5f6170]",
              )}
            >
              <NavIcon name={section.icon} className="size-5 stroke-[1.6]" />
            </Link>
          );
        })}
      </nav>
      <div className="pt-2">
        <NavInspection compact />
      </div>
    </div>
  );
}

/**
 * Меню слева в шаблоне «Новый»: белая карточка на сером фоне страницы, в
 * ней логотип, дерево меню (`NavAccordion`) с внутренней прокруткой и
 * стрелками, внизу — всегда видная «Пришла проверка». Меню сворачивается
 * в узкую полосу с иконками разделов и разворачивается обратно (выбор
 * помнится на устройстве).
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
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  return (
    <aside
      data-app-sidebar
      data-sidebar-layout="new"
      data-sidebar-collapsed={collapsed ? "" : undefined}
      aria-label={t("sidebarAria")}
      className={cn(
        "sticky top-0 z-20 hidden h-screen shrink-0 p-3 pr-0 lg:flex print:hidden",
        collapsed ? "w-[80px]" : "w-[300px]",
      )}
    >
      {collapsed ? (
        <CollapsedRail onExpand={() => setCollapsed(false)} />
      ) : (
        <div className="relative flex min-h-0 w-full flex-col rounded-2xl border border-[#eeeef2] bg-white shadow-[0_1px_3px_rgba(17,17,20,0.04)]">
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label={t("collapseMenu")}
            title={t("collapseMenu")}
            className="absolute top-3 right-3 z-10 flex size-9 items-center justify-center rounded-[10px] text-[#8a8d9c] transition-colors hover:bg-[#f1f1f4] hover:text-[#111114] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/10"
          >
            <PanelLeftClose className="size-[18px] stroke-[1.6]" aria-hidden />
          </button>
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
          <nav aria-label={t("sidebarAria")} className="flex min-h-0 flex-1 flex-col">
            <SidebarScroll>
              <NavAccordion inspectionInline={false} />
            </SidebarScroll>
          </nav>
          <div className="shrink-0 border-t border-[#eeeef2] p-3">
            <NavInspection />
          </div>
        </div>
      )}
    </aside>
  );
}

"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { mainNavSections, sectionForPath, type NavSectionKey } from "@/lib/app-nav";
import type { NavModelMenuItem, NavModelSection } from "@/lib/app-nav.server";
import { navTone } from "@/lib/nav-tones";
import { cn } from "@/lib/utils";
import { useAppNav } from "@/components/layout/app-nav-context";
import { NavIconChip } from "@/components/layout/nav-icons";
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


// Пункт меню: слева цветная плашка 32px (вариант C, 2026-10-29) — отступ
// слева меньше, чтобы плашка стояла ближе к краю, как в макете.
const SIDEBAR_ITEM =
  "relative flex min-h-11 items-center gap-2.5 rounded-2xl py-1.5 pr-2.5 pl-1.5 text-[14.5px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

// Плашка пункта и выбранный пункт: фон и текст своего тона (`data-tone`
// строки), полоска слева и кольцо вокруг плашки — `data-active` в app-theme.css.
const SIDEBAR_CHIP = "size-8 rounded-[10px]";
const SIDEBAR_CHIP_ICON = "size-[18px]";
const SIDEBAR_ITEM_ACTIVE = "bg-[var(--tone-row)] font-semibold text-[var(--tone-ink)]";
const SIDEBAR_ITEM_IDLE = "text-[#3c4053] hover:bg-[#f5f6ff] hover:text-[#0b1024]";

/**
 * Меню кабинета слева (≥1024px): по центру логотип компании (нет — заглушка,
 * руководителю — кнопка «Загрузить логотип»), под ним краткое название и ИНН,
 * ниже разделы. «Пришла проверка» прижата к низу — в спешке её
 * ищут глазами первой; это отдельное действие (контурная кнопка), а не
 * выбранный пункт. У разделов со своим меню — стрелка ›.
 *
 * У каждого пункта своя цветная плашка (владелец, 2026-10-29, вариант C):
 * цвет — по иконке (`lib/nav-tones.ts`). Знака «сетап» под меню больше нет —
 * место отдано меню.
 *
 * У раздела своё меню (`section.menu`): при входе в раздел левое меню
 * меняется целиком. Разделы вложены (эскизы 2026-10-28: «Моя компания →
 * Торговые точки → Журналы»): пункт-раздел со стрелкой открывает меню
 * вложенного раздела и его страницу, «‹ Назад» поднимает на уровень вверх
 * и меню, и страницу (владелец, 2026-10-28: «Назад» возвращает не только
 * список, но и основное поле): в меню родителя и на его корень, из раздела
 * главного меню — в главное меню и на главную (`homeHref`).
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
}: {
  logoUrl: string | null;
  organizationName: string;
  /** Под логотипом: краткое название и ИНН (эскиз: «Юр. наименование (сокр.)»). */
  identity: SidebarOrgIdentity;
  homeHref: string;
  canEditBranding?: boolean;
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
  // меню текущего раздела (`hostKey`). После «‹ Назад» меню уровнем выше
  // показано сразу и переходит на страницу, куда «Назад» привела (`follow`):
  // главная может лежать внутри раздела и даже перенаправлять дальше (у
  // заведующей «Журналы» → панель контроля), а меню остаётся главным.
  const [view, setView] = useState<{ path: string; key: NavSectionKey | "main"; follow?: boolean } | null>(null);
  // Сменилась страница: после «Назад» выбранное меню закрепляется за новой
  // страницей, в остальных случаях — забывается (возврат кнопкой браузера
  // покажет меню той страницы, а не прежний выбор).
  if (view && view.path !== pathname) setView(view.follow ? { path: pathname, key: view.key } : null);
  const viewKey = view && (view.path === pathname || view.follow) ? view.key : (hostKey ?? "main");
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
  const backRef = useRef<HTMLAnchorElement>(null);
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
  // «‹ Назад»: меню родителя и его корень; родителя нет (или он закрыт
  // человеку) — главное меню и главная.
  const parentSection = viewSection?.parent
    ? sections.find((section) => section.key === viewSection.parent && section.menu)
    : undefined;
  const backHref = parentSection ? parentSection.rootHref : homeHref;
  const backPath = backHref.split(/[?#]/)[0] || "/";
  const goBack = (event: MouseEvent<HTMLAnchorElement>) => {
    // Открытие в новой вкладке — меню здесь не трогаем.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    // Уже на этой странице — переход не нужен, меняется только меню.
    const stay = backPath === pathname;
    if (stay) event.preventDefault();
    focusAfter.current = viewSection?.key ?? null;
    setView({ path: pathname, key: parentSection ? parentSection.key : "main", follow: !stay });
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
  // Номер пункта сквозь группы — для каскада при входе в меню раздела.
  const groupOffsets = menuSection.menu.map((_, index) =>
    menuSection.menu!.slice(0, index).reduce((sum, group) => sum + group.items.length, 0),
  );

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
            <Link
              ref={backRef}
              href={backHref}
              onClick={goBack}
              data-back-to-main
              data-back-href={backPath}
              className="inline-flex h-9 items-center gap-1 rounded-xl px-2.5 text-[13.5px] font-semibold text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <ChevronLeft className="size-4" aria-hidden />
              {t("back")}
            </Link>
          </div>
          <Link
            href={menuSection.rootHref}
            data-tone={navTone(menuSection.icon)}
            data-nav-row
            className="group mx-3 mt-1 flex shrink-0 items-center gap-2.5 rounded-xl px-1.5 pt-2 pb-1.5 text-[15px] font-bold text-[#0b1024] transition-colors duration-150 hover:text-[var(--tone-ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            <NavIconChip name={menuSection.icon} className="size-7 rounded-[9px]" iconClassName="size-4" />
            {menuSection.label}
          </Link>
          {/* Ключ — показанное меню: при входе в раздел и при «‹ Назад» в
              родителя меню собирается заново, и пункты появляются каскадом
              (`data-nav-rise`). Спрятанная панель — без анимации. */}
          <nav
            key={showSection ? viewKey : "hidden"}
            aria-label={t("sectionMenuAria")}
            data-section-menu={menuSection.key}
            data-nav-rise={showSection ? "" : undefined}
            className="min-h-0 flex-1 overflow-y-auto px-3 pb-4"
          >
            {menuSection.menu.map((group, index) => (
              <div key={group.label ?? `group-${index}`}>
                {group.label ? (
                  <div className="px-2.5 pt-3.5 pb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#9b9fb3]">
                    {group.label}
                  </div>
                ) : null}
                <div className="space-y-1">
                  {group.items.map((item, itemIndex) => {
                    const isActive = menuItemActive(item);
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        onClick={item.section ? selectHandler(item.section, Boolean(item.hasMenu)) : undefined}
                        aria-current={isActive ? (item.section ? "true" : "page") : undefined}
                        data-menu-item={item.id}
                        data-menu-section={item.section}
                        data-tone={navTone(item.icon)}
                        data-nav-row
                        data-nav-bar
                        data-active={isActive ? "" : undefined}
                        style={{ "--nav-i": groupOffsets[index] + itemIndex } as CSSProperties}
                        className={cn(SIDEBAR_ITEM, "group", isActive ? SIDEBAR_ITEM_ACTIVE : SIDEBAR_ITEM_IDLE)}
                      >
                        <NavIconChip name={item.icon} className={SIDEBAR_CHIP} iconClassName={SIDEBAR_CHIP_ICON} />
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
 * пункт, поэтому в покое это контурная кнопка (белая, с рамкой и розовой
 * плашкой), а заливка — только когда раздел открыт, как у остальных пунктов.
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
      data-tone={navTone(section.icon)}
      data-nav-row
      data-nav-bar
      data-active={active ? "" : undefined}
      className={cn(
        SIDEBAR_ITEM,
        "group",
        action
          ? active
            ? cn("border border-transparent", SIDEBAR_ITEM_ACTIVE)
            : "border border-[#dcdfed] bg-white text-[#0b1024] shadow-[0_1px_2px_rgba(11,16,36,0.04)] hover:border-[var(--tone-glow)] hover:bg-[var(--tone-row)]"
          : active
            ? SIDEBAR_ITEM_ACTIVE
            : SIDEBAR_ITEM_IDLE,
      )}
    >
      <NavIconChip name={section.icon} className={SIDEBAR_CHIP} iconClassName={SIDEBAR_CHIP_ICON} />
      <span className="min-w-0 flex-1">{section.label}</span>
      {section.menu ? <NavChevron active={active} /> : null}
    </Link>
  );
}

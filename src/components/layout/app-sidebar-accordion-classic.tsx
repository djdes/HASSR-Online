"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, Component, ShieldAlert } from "lucide-react";
import { mainNavSections, type NavSectionKey } from "@/lib/app-nav";
import type { NavModelSection } from "@/lib/app-nav.server";
import { navTone } from "@/lib/nav-tones";
import { cn } from "@/lib/utils";
import { useAppNav } from "@/components/layout/app-nav-context";
import { NavIconChip } from "@/components/layout/nav-icons";
import { useNewNavPlace } from "@/components/layout/nav-layout-switch";
import { sectionEntryHref } from "@/lib/nav-layout";
import { OrganizationBrand } from "@/components/layout/organization-brand";
import { NavBadge } from "@/components/layout/section-menu-list";
import type { SidebarOrgIdentity } from "@/lib/sidebar-org-identity";
import { ScrollPane } from "@/components/ui/scroll-list";
import { INSPECTION_ACTIVE, INSPECTION_DOCK, INSPECTION_ICON, INSPECTION_IDLE } from "@/components/layout/nav-inspection-style";

// Строка раздела — как в стандартном меню: иконка в коробке 32px.
const ROW =
  "relative flex min-h-11 items-center gap-2.5 rounded-2xl py-1.5 pr-2.5 pl-1.5 text-[14.5px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";
// Пункт раскрытого списка — ниже и с иконкой поменьше: второй уровень.
const SUB_ROW =
  "relative flex min-h-10 items-center gap-2 rounded-xl py-1 pr-2 pl-1.5 text-[14px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";
// Вес шрифта у выбранного не меняется: жирная «Мастер-кабинет» рядом с «PRO»
// переносилась на вторую строку.
// Телефон: строка под палец — выше и крупнее.
const ROW_TOUCH = "min-h-[52px] text-[16px]";
const SUB_ROW_TOUCH = "min-h-12 text-[15.5px]";
const ROW_ACTIVE = "bg-[var(--tone-row)] text-[var(--tone-ink)]";
// «Ещё» — тихий пункт в конце списка: серый, без своего цвета.
const ROW_QUIET = "text-[#6f7282] hover:bg-[#f4f5fb] hover:text-[#3c4053]";
const ROW_QUIET_ACTIVE = "bg-[#f1f2f8] text-[#0b1024]";
const ROW_IDLE = "text-[#3c4053] hover:bg-[#f5f6ff] hover:text-[#0b1024]";

/**
 * Список меню в два уровня — общий для сайдбара на компьютере и листа меню на
 * телефоне (владелец, 2026-11-11: «в мобильной версии должен быть новый
 * дизайн»). `touch` — строки выше и кегль крупнее, под палец.
 */
export function ClassicNavAccordion({ touch = false }: { touch?: boolean }) {
  const { sections } = useAppNav();
  const pathname = usePathname() || "/";
  const place = useNewNavPlace();
  const mainSections = mainNavSections(sections);
  const main = mainSections.filter((section) => section.key !== "inspection");
  const inspection = mainSections.find((section) => section.key === "inspection");

  // Какой список раскрыт, помним вместе с путём: сменилась страница — снова
  // раскрыт раздел текущей страницы.
  const [manual, setManual] = useState<{ path: string; key: NavSectionKey | null } | null>(null);
  if (manual && manual.path !== pathname) setManual(null);
  const openKey = manual ? manual.key : place.top;

  const onSection = (section: NavModelSection) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!section.menu) return;
    // Открытие в новой вкладке — меню здесь не трогаем.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (openKey === section.key) {
      event.preventDefault();
      // Только раскрыли список: лист меню на телефоне от этого не закрывается.
      event.stopPropagation();
      setManual({ path: pathname, key: null });
    } else if (touch) {
      // Телефон (владелец, 2026-11-11): страница раздела грузится в фоне, а
      // лист не закрывается и раскрывает пункты — видно, что внутри. Раздел,
      // где человек уже стоит, только раскрывается.
      if (place.top === section.key) event.preventDefault();
      event.stopPropagation();
      setManual({ path: pathname, key: section.key });
    } else {
      // Раздел, в котором человек уже стоит, только раскрывается; другой —
      // раскрывается сразу и открывает свой корень.
      if (place.top === section.key) {
        event.preventDefault();
        event.stopPropagation();
      }
      setManual({ path: pathname, key: section.key });
    }
  };

  // Строка раздела и его раскрытый список — отдельно: у «Пришла проверка»
  // закреплена только строка, а список идёт за ней (`sticky` держит строку
  // внизу меню, пока до неё не долистали, и с открытым списком тоже).
  const renderRow = (section: NavModelSection, action = false) => {
    const active = place.top === section.key;
    const open = Boolean(section.menu) && openKey === section.key;
    return (
      <Link
        href={sectionEntryHref(section)}
        onClick={onSection(section)}
        aria-current={active ? (section.menu ? "true" : "page") : undefined}
        aria-expanded={section.menu ? open : undefined}
        data-nav-section={section.key}
        data-nav-action={action ? "" : undefined}
        data-tone={action ? undefined : navTone(section.icon)}
        data-nav-row
        data-nav-bar
        data-active={active ? "" : undefined}
        className={cn(
          ROW,
          touch && ROW_TOUCH,
          "group",
          action ? (active ? INSPECTION_ACTIVE : INSPECTION_IDLE) : active ? ROW_ACTIVE : ROW_IDLE,
        )}
      >
        {action ? (
          // Экстренное действие: щит тоном предупреждения, без своей плашки.
          <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center">
            <ShieldAlert className={cn("size-[18px]", INSPECTION_ICON)} />
          </span>
        ) : (
          <NavIconChip name={section.icon} className="size-8 rounded-[10px]" iconClassName="size-[18px]" />
        )}
        <span className="min-w-0 flex-1">{section.label}</span>
        {section.menu ? (
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
              action ? (open ? "rotate-180" : "") : open ? "rotate-180 text-[var(--tone,#5566f6)]" : "text-[#9b9fb3]",
              action && "text-current opacity-60",
            )}
          />
        ) : null}
      </Link>
    );
  };

  const renderSublist = (section: NavModelSection) => {
    const active = place.top === section.key;
    const open = Boolean(section.menu) && openKey === section.key;
    return open && section.menu ? (
      <div
        data-nav-sublist={section.key}
        // Без бокса и рамки (владелец, 2026-11-22): второй уровень отличается отступом.
        className="mt-0.5 mb-1.5 pl-2.5"
      >
        {section.menu.map((group, index) => (
          <div key={group.label ?? `group-${index}`}>
            {group.label ? (
              <div className="px-2.5 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#6f7282]">
                {group.label}
              </div>
            ) : null}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const itemActive = active && place.secondId === item.id;
                const quiet = item.section === "more";
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    aria-current={itemActive ? (item.section ? "true" : "page") : undefined}
                    data-menu-item={item.id}
                    data-menu-section={item.section}
                    data-menu-quiet={quiet ? "" : undefined}
                    data-tone={quiet ? undefined : navTone(item.icon)}
                    data-nav-row
                    data-active={itemActive ? "" : undefined}
                    className={cn(
                      SUB_ROW,
                      touch && SUB_ROW_TOUCH,
                      "group",
                      quiet
                        ? cn("mt-0.5", itemActive ? ROW_QUIET_ACTIVE : ROW_QUIET)
                        : itemActive
                          ? ROW_ACTIVE
                          : ROW_IDLE,
                    )}
                  >
                    {quiet ? (
                      <span aria-hidden className="inline-flex size-7 shrink-0 items-center justify-center text-[#6f7282]">
                        <Component className="size-4" />
                      </span>
                    ) : (
                      <NavIconChip name={item.icon} className="size-7 rounded-[9px]" iconClassName="size-4" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge ? <NavBadge>{item.badge}</NavBadge> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    ) : null;
  };

  const renderSection = (section: NavModelSection) => (
    <div key={section.key}>
      {renderRow(section)}
      {renderSublist(section)}
    </div>
  );

  return (
    <>
      <div className={touch ? "space-y-1" : "space-y-1 pb-4"}>{main.map((section) => renderSection(section))}</div>
      {inspection ? (
        <>
          {/* «Пришла проверка» закреплена внизу меню и на телефоне, и на
              компьютере (владелец, 2026-11-22), в том числе с открытым
              списком раздела — он идёт следом. Компьютер: полоса 73px, как
              подвал справа (`DashboardFooter`): 1 + 13 + 46 (кнопка) + 13. */}
          <div
            data-nav-bottom
            className={cn(
              INSPECTION_DOCK,
              touch ? "mt-auto pt-3 pb-1" : "-mx-3 mt-auto border-t border-transparent px-3 py-[13px]",
            )}
          >
            {renderRow(inspection, true)}
          </div>
          {renderSublist(inspection)}
        </>
      ) : null}
    </>
  );
}

/**
 * Прежний дизайн (без «Новой» темы). Меню слева в шаблоне «Новый» (владелец, 2026-11-09): только два уровня.
 * Разделы главного меню, под разделом — раскрывающийся список его пунктов.
 * Раскрыт раздел, в котором человек находится; нажатие на другой раздел
 * открывает его корень и его список, нажатие на раскрытый — сворачивает.
 * Всё, что глубже, — строка над страницей (`SectionTopMenu`). Внизу —
 * «Пришла проверка». Иконки — плоские, в цвет пункта, без градиента и колец
 * (2026-11-11: «минималистичнее»); правила — `app-theme.css`.
 */
export function ClassicSidebarAccordion({
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
      className="sticky top-0 z-20 hidden h-screen w-[256px] shrink-0 flex-col border-r border-transparent bg-white lg:flex print:hidden"
    >
      <div className="shrink-0 px-5 pt-5 pb-3" data-sidebar-logo>
        <OrganizationBrand
          logoUrl={logoUrl}
          name={organizationName}
          identity={identity}
          homeHref={homeHref}
          canEditBranding={canEditBranding}
          large
        />
      </div>
      {/* Своя видимая полоса прокрутки (владелец, 2026-11-22). */}
      <nav className="flex min-h-0 flex-1 flex-col">
        <ScrollPane>
          <div className="flex min-h-full flex-col px-3 pt-4">
            <ClassicNavAccordion />
          </div>
        </ScrollPane>
      </nav>
    </aside>
  );
}

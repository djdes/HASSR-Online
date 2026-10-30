"use client";

import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, ChevronUp, House } from "lucide-react";
import type { NavModelSection } from "@/lib/app-nav.server";
import { mainNavSections, navSectionPath, type NavSectionKey } from "@/lib/app-nav";
import { navTone } from "@/lib/nav-tones";
import { cn } from "@/lib/utils";
import { useAppNav } from "@/components/layout/app-nav-context";
import { NavIconChip } from "@/components/layout/nav-icons";
import { SectionStatusDot } from "@/components/layout/section-status-dot";
import type { PpkNavStatus } from "@/components/layout/use-section-statuses";

// Пункт меню раздела: 48px высотой, как строки оглавления на телефоне.
// Слева цветная плашка 36px (вариант C, 2026-10-29) — цвет по иконке.
const SECTION_ROW =
  "relative flex min-h-[48px] items-center gap-3 rounded-2xl py-1.5 pr-3.5 pl-1.5 text-[16px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

// Строка раздела в главном меню листа: от 52px высотой, шрифт 17px,
// плашка 40px — палец попадает с первого раза.
const MAIN_ROW =
  "relative flex min-h-[52px] items-center gap-3 rounded-2xl py-1.5 pr-3.5 pl-1.5 text-[17px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

// Выбранная строка листа — фон и текст своего тона (`data-tone` строки).
const ROW_ACTIVE = "bg-[var(--tone-row)] font-semibold text-[var(--tone-ink)]";

/** Раздел и его видимые предки — от самого раздела вверх. */
export function sectionChain(sections: NavModelSection[], key: NavSectionKey | null | undefined): NavModelSection[] {
  const chain: NavModelSection[] = [];
  let current = key ? sections.find((section) => section.key === key) : undefined;
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = current.parent ? sections.find((section) => section.key === current?.parent) : undefined;
  }
  return chain;
}

/**
 * Чьё меню показывать на пути раздела `key`: сам раздел, если у него есть
 * меню, иначе ближайший предок с меню («Остальное» — в меню «Моей компании»).
 */
export function menuHostKey(sections: NavModelSection[], key: NavSectionKey | null | undefined): NavSectionKey | null {
  return sectionChain(sections, key).find((section) => section.menu)?.key ?? null;
}

/** Раздел главного меню, в котором лежит раздел `key`. */
export function topSectionKey(sections: NavModelSection[], key: NavSectionKey | null | undefined): NavSectionKey | null {
  return sectionChain(sections, key).at(-1)?.key ?? null;
}

/** Куда ведёт вкладка стопки: ссылка (сайдбар) или кнопка (лист). */
export type PlaceTarget = { href?: string; onClick?: (event: MouseEvent<HTMLElement>) => void };

const STACK_SIZES = {
  sidebar: {
    tab: "-mb-3 min-h-[38px] rounded-t-[14px] px-2.5 pt-1.5 pb-[18px] text-[12.5px]",
    icon: "size-3.5",
    chip: "size-5 rounded-[6px]",
    chipIcon: "size-3",
    head: "min-h-11 gap-2.5 text-[15.5px]",
    headChip: "size-8 rounded-[10px]",
    headIcon: "size-[18px]",
  },
  sheet: {
    tab: "-mb-3.5 min-h-[42px] rounded-t-2xl px-3 pt-[7px] pb-[21px] text-[14px]",
    icon: "size-4",
    chip: "size-[22px] rounded-[7px]",
    chipIcon: "size-[13px]",
    head: "min-h-12 gap-3 text-[18px]",
    headChip: "size-[38px] rounded-xl",
    headIcon: "size-[21px]",
  },
} as const;

/** На столько уже следующей вкладки каждая дальняя (px с каждой стороны). */
const STACK_STEP = 8;

const STACK_TAB =
  "relative flex w-full items-center gap-2 text-left font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

function PlaceLink({
  target,
  className,
  order,
  current = false,
  attrs,
  children,
}: {
  target: PlaceTarget;
  className: string;
  /** Номер в каскаде входа (`--nav-i`): сначала вкладки, заголовок, за ними пункты меню. */
  order: number;
  current?: boolean;
  attrs?: Record<string, string>;
  children: ReactNode;
}) {
  const common = {
    className,
    style: { "--nav-i": order } as CSSProperties,
    "aria-current": current ? ("location" as const) : undefined,
    ...attrs,
  };
  return target.href !== undefined ? (
    <Link href={target.href} onClick={target.onClick} {...common}>
      {children}
    </Link>
  ) : (
    <button type="button" onClick={target.onClick} {...common}>
      {children}
    </button>
  );
}

/**
 * «Стопка уровней» — меню раздела (владелец выбрал вариант 5 макета
 * «вложенность меню», 2026-10-30). Меню разделов вложено, и при входе левое
 * меню меняется целиком — путь «Моя компания → Торговые точки → Журналы»
 * терялся. Здесь родители — вкладки, выглядывающие из-под карточки текущего
 * раздела, как карточки в стопке: «Главное меню» серая и самая узкая, дальше
 * разделы-родители в своих цветах, ближайший — шире всех. Вкладка — переход
 * на свой уровень (`root`, `step`); ближайшая заменила «‹ Назад». Пункты
 * меню (`children`) лежат в карточке, её заголовок ведёт на корень раздела.
 * Вид вкладок и карточки — `[data-place-tab]`, `[data-place-card]` в
 * app-theme.css.
 */
export function SectionStack({
  path,
  size,
  root,
  step,
  className,
  children,
}: {
  /** Разделы сверху вниз, последний — текущий (`navSectionPath`). */
  path: readonly NavModelSection[];
  size: keyof typeof STACK_SIZES;
  root: PlaceTarget;
  step: (section: NavModelSection) => PlaceTarget;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("navigation.shell");
  const current = path.at(-1);
  if (!current) return null;
  const sizes = STACK_SIZES[size];
  // Вкладок столько же, сколько разделов в пути: «Главное меню» и родители.
  const inset = (index: number): CSSProperties => ({ marginInline: (path.length - index) * STACK_STEP });
  const up = <ChevronUp className={cn("shrink-0 opacity-70", sizes.icon)} aria-hidden />;
  return (
    <div data-section-place={current.key} className={cn("flex flex-col", className)}>
      <nav aria-label={t("placeAria")}>
        <ol className="flex flex-col">
          <li data-place-tab="root" style={inset(0)}>
            <PlaceLink
              target={root}
              order={0}
              attrs={{ "data-place-root": "", "data-nav-row": "" }}
              className={cn(STACK_TAB, sizes.tab)}
            >
              <House className={cn("shrink-0", sizes.icon)} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t("backToMain")}</span>
              {up}
            </PlaceLink>
          </li>
          {path.slice(0, -1).map((section, index) => (
            <li key={section.key} data-place-tab="" data-tone={navTone(section.icon)} style={inset(index + 1)}>
              <PlaceLink
                target={step(section)}
                order={index + 1}
                attrs={{ "data-place-section": section.key, "data-nav-row": "" }}
                className={cn(STACK_TAB, sizes.tab)}
              >
                <NavIconChip name={section.icon} className={sizes.chip} iconClassName={sizes.chipIcon} />
                <span className="min-w-0 flex-1 truncate">{section.label}</span>
                {up}
              </PlaceLink>
            </li>
          ))}
        </ol>
      </nav>
      <div
        data-place-card
        data-tone={navTone(current.icon)}
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl"
      >
        <div className="mx-1.5 mt-1.5 shrink-0 border-b border-[#ececf4] pb-1.5">
          <PlaceLink
            target={{ href: current.rootHref }}
            order={path.length}
            current
            attrs={{ "data-place-current": current.key, "data-nav-row": "" }}
            className={cn(
              "group flex items-center rounded-xl px-2 py-1 font-extrabold leading-tight text-[var(--tone-ink)] [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
              sizes.head,
            )}
          >
            <NavIconChip name={current.icon} className={sizes.headChip} iconClassName={sizes.headIcon} />
            <span className="min-w-0 flex-1">{current.label}</span>
          </PlaceLink>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Метка у пункта меню («PRO»): градиентная, в тон цветным плашкам. */
export function NavBadge({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-full bg-[#6d4bf0] bg-[linear-gradient(135deg,#6d4bf0,#a925c0)] px-2 py-0.5 text-[11px] font-bold tracking-[0.04em] text-white shadow-[0_4px_10px_-4px_rgba(124,92,245,0.6)]">
      {children}
    </span>
  );
}

/**
 * Список меню раздела для листа снизу: «стопка уровней» (родители —
 * вкладки, раздел — карточка со ссылкой на свой корень), в карточке группы и
 * пункты с точками статуса. Общий для мобильного листа сайта и кнопки меню в
 * Mini App (П-3).
 */
export function SectionMenuList({
  section,
  activeItemId,
  currentKey,
  statuses,
  onOpenMenu,
  onGoTo,
}: {
  section: NavModelSection;
  activeItemId: string | undefined;
  /** Раздел текущей страницы: пункт-раздел подсвечен, пока человек внутри него. */
  currentKey: NavSectionKey | null;
  statuses: Record<string, PpkNavStatus>;
  /** Нажатие на вложенный раздел со стрелкой раскрывает его меню в листе. */
  onOpenMenu?: (key: NavSectionKey) => void;
  /** Вкладка стопки: листает меню на свой уровень (без перехода). */
  onGoTo: (key: NavSectionKey | "main") => void;
}) {
  const { sections } = useAppNav();
  if (!section.menu) return null;
  const inside = new Set(sectionChain(sections, currentKey).map((entry) => entry.key));
  return (
    <SectionStack
      path={navSectionPath(sections, section.key)}
      size="sheet"
      root={{ onClick: () => onGoTo("main") }}
      step={(entry) => ({ onClick: () => onGoTo(entry.key) })}
      className="mb-1"
    >
      <div className="flex flex-col gap-1 p-1.5">
        {section.menu.map((group, index) => (
          <div key={group.label ?? `group-${index}`} className="flex flex-col gap-1">
            {group.label ? (
              <div className="px-2.5 pt-3.5 pb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#9b9fb3]">
                {group.label}
              </div>
            ) : null}
            {group.items.map((item) => {
              const isActive = item.section ? inside.has(item.section) : activeItemId === item.id;
              const className = cn(
                SECTION_ROW,
                "group w-full text-left",
                isActive ? ROW_ACTIVE : "text-[#3c4053] hover:bg-[#fafbff]",
              );
              const rowProps = {
                "data-menu-item": item.id,
                "data-menu-section": item.section,
                "data-tone": navTone(item.icon),
                "data-nav-row": "",
                "data-has-menu": item.hasMenu ? "" : undefined,
                "data-active": isActive ? "" : undefined,
                className,
              };
              const content = (
                <>
                  <NavIconChip name={item.icon} className="size-9 rounded-xl" iconClassName="size-5" />
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {item.badge ? <NavBadge>{item.badge}</NavBadge> : null}
                  <SectionStatusDot status={statuses[item.id]} />
                  {item.hasMenu ? <NavChevron active={isActive} /> : null}
                </>
              );
              return item.section && item.hasMenu && onOpenMenu ? (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenMenu(item.section!)}
                  aria-current={isActive ? "true" : undefined}
                  {...rowProps}
                >
                  {content}
                </button>
              ) : (
                <Link
                  key={item.id}
                  href={item.href}
                  aria-current={isActive ? (item.section ? "true" : "page") : undefined}
                  {...rowProps}
                >
                  {content}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </SectionStack>
  );
}

/**
 * Стрелка › у пункта главного меню, у которого есть своё меню раздела
 * (руководитель: «все меню, которые разворачиваются, должны быть со
 * стрелочкой»). Видна всегда, не только у активного пункта и не только при
 * наведении; при наведении на пункт чуть сдвигается и берёт цвет пункта
 * (`--tone` строки; вне цветной строки — индиго). Переход — в app-theme.css.
 */
export function NavChevron({ active = false, className }: { active?: boolean; className?: string }) {
  return (
    <ChevronRight
      aria-hidden
      data-nav-chevron
      className={cn(
        "size-4 shrink-0",
        active
          ? "text-[var(--tone,#5566f6)]"
          : "text-[#9b9fb3] group-hover:translate-x-0.5 group-hover:text-[var(--tone,#5566f6)]",
        className,
      )}
    />
  );
}

/**
 * Главное меню списком для листа снизу (разделы без видимого родителя). «Пришла проверка» —
 * под чертой, контурной кнопкой, как в сайдбаре. Общий для листа сайта и листа
 * Mini App.
 *
 * У раздела со своим меню — стрелка ›, и с `onOpenMenu` нажатие раскрывает
 * его меню прямо в листе (стрелка обещает именно это), а не уводит на корень
 * раздела с закрытием листа. Раздел без меню («Остальное») — обычная ссылка.
 */
export function NavSectionsList({
  sections,
  currentKey,
  onOpenMenu,
}: {
  sections: NavModelSection[];
  /** Раздел текущей страницы: подсвечен его раздел главного меню. */
  currentKey: NavSectionKey | null;
  onOpenMenu?: (key: NavSectionKey) => void;
}) {
  const active = topSectionKey(sections, currentKey);
  return (
    <>
      {mainNavSections(sections).map((section) => {
        const isActive = active === section.key;
        const action = section.key === "inspection";
        const className = cn(
          MAIN_ROW,
          "group w-full text-left",
          action
            ? isActive
              ? cn("border border-transparent", ROW_ACTIVE)
              : "border border-[#dcdfed] bg-white text-[#0b1024] hover:border-[var(--tone-glow)] hover:bg-[var(--tone-row)]"
            : isActive
              ? ROW_ACTIVE
              : "text-[#3c4053] hover:bg-[#fafbff]",
        );
        const rowProps = {
          "aria-current": isActive ? ("page" as const) : undefined,
          "data-nav-section": section.key,
          "data-nav-action": action ? "" : undefined,
          "data-tone": navTone(section.icon),
          "data-nav-row": "",
          "data-has-menu": section.menu ? "" : undefined,
          "data-active": isActive ? "" : undefined,
          className,
        };
        const content = (
          <>
            <NavIconChip name={section.icon} className="size-10 rounded-xl" iconClassName="size-[22px]" />
            <span className="min-w-0 flex-1">{section.label}</span>
            {section.menu ? <NavChevron active={isActive} className="size-5" /> : null}
          </>
        );
        const row =
          section.menu && onOpenMenu ? (
            <button key={section.key} type="button" onClick={() => onOpenMenu(section.key)} {...rowProps}>
              {content}
            </button>
          ) : (
            <Link key={section.key} href={section.rootHref} {...rowProps}>
              {content}
            </Link>
          );
        return action ? (
          <div key={section.key} className="mt-1 border-t border-[#ececf4] pt-2">
            {row}
          </div>
        ) : (
          row
        );
      })}
    </>
  );
}

/**
 * Что показано в листе меню (сайт на телефоне и Mini App): меню раздела или
 * главное меню. По умолчанию — меню текущего раздела (`currentKey` — раздел,
 * чьё меню хозяин пути, см. `menuHostKey`), иначе главное. Вкладки стопки
 * (`goTo`) поднимают на свой уровень, а нажатие на раздел со стрелкой
 * раскрывает его меню на месте, без перехода; выбор помним вместе с путём —
 * после перехода или закрытия листа (`reset`) снова видно меню текущего
 * раздела. Фокус не теряется: после входа в раздел — на ближайшую вкладку
 * (родителя), после выхода — на строку раздела, из которого вышли.
 */
export function useSheetMenu({
  scope,
  sections,
  currentKey,
  pathname,
}: {
  /** Метка листа: `data-sheet-menu={scope}` на его `nav` — там ищем, куда поставить фокус. */
  scope: string;
  sections: NavModelSection[];
  currentKey: NavSectionKey | null;
  pathname: string;
}) {
  // `focus` — куда поставить фокус после переключения: "parent" (ближайшая
  // вкладка стопки) или ключ раздела.
  const [view, setView] = useState<{ path: string; key: NavSectionKey | "main"; focus: string } | null>(null);
  const current = view && view.path === pathname ? view : null;
  const viewKey = current ? current.key : (currentKey ?? "main");
  const shown = viewKey === "main" ? undefined : sections.find((section) => section.key === viewKey && section.menu);
  useEffect(() => {
    if (!current) return;
    const box = document.querySelector(`[data-sheet-menu="${scope}"]`);
    const element =
      current.focus === "parent"
        ? [...(box?.querySelectorAll<HTMLElement>("[data-place-tab] > button") ?? [])].at(-1)
        : (box?.querySelector<HTMLElement>(`[data-nav-section="${current.focus}"], [data-menu-section="${current.focus}"]`) ??
          box?.querySelector<HTMLElement>("[data-nav-section], [data-menu-item]"));
    element?.focus();
  }, [current, scope]);
  return {
    /** Раздел, чьё меню сейчас в листе; `undefined` — главное меню. */
    shown,
    /** Раскрыть меню раздела в листе. */
    openMenu: (key: NavSectionKey) => setView({ path: pathname, key, focus: "parent" }),
    /**
     * Вкладка стопки: меню выбранного уровня (`main` — главное).
     * Фокус — на пункт, через который из этого меню шли вглубь.
     */
    goTo: (key: NavSectionKey | "main") => {
      const path = shown ? navSectionPath(sections, shown.key) : [];
      const from = path[key === "main" ? 0 : path.findIndex((section) => section.key === key) + 1];
      setView({ path: pathname, key, focus: from?.key ?? "main" });
    },
    reset: () => setView(null),
  };
}


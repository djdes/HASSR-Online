"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Messages } from "@/i18n/messages";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BadgePercent,
  Bot,
  ChevronDown,
  ClipboardList,
  FileClock,
  FileDown,
  FileSignature,
  FileText,
  Filter,
  Gauge,
  Handshake,
  HeartPulse,
  Languages,
  LayoutDashboard,
  Lightbulb,
  Mail,
  Megaphone,
  type LucideIcon,
  Menu,
  MessageSquareText,
  NotebookText,
  ScrollText,
  SearchCheck,
  Smile,
  Sparkles,
  Stamp,
  Star,
  Ticket,
  Timer,
  UserCog,
  UsersRound,
  Wallet,
} from "lucide-react";

import {
  BottomSheet,
  SHEET_GROUP_LABEL_CLASS,
  SHEET_ROW_CLASS,
} from "@/components/ui/bottom-sheet";
import {
  MENU_ITEM_ACTIVE_CLASS,
  MENU_ITEM_CLASS,
  MENU_PANEL_CLASS,
  MENU_PANEL_PADDING_CLASS,
} from "@/components/ui/menu-styles";
import { cn } from "@/lib/utils";
import { canAccessPlatformPath, type PlatformViewer } from "@/lib/platform-access";

/**
 * Навигация платформенной панели.
 *
 * Разделов девятнадцать, и одной строкой они не помещались: подписи
 * сжимались до переноса, а последние пункты уезжали за край экрана.
 * Поэтому верхний уровень — шесть элементов: «Организации» прямой
 * ссылкой (туда заходят чаще всего) и четыре смысловые группы.
 *
 * Группы раскрываются наведением и фокусом с клавиатуры — приём тот же,
 * что в шапке кабинета: обёртка `group/nav` покрывает и кнопку, и панель,
 * поэтому курсор не проваливается в зазор между ними. Клик по кнопке
 * тоже открывает — на планшете и в тач-режиме десктопа наведения нет.
 *
 * Пункты остаются настоящими `<Link>`: живут prefetch, средняя кнопка
 * мыши и «открыть в новой вкладке». Меню на `router.push` этого лишает.
 */

type NavLink = { href: string; label: keyof Messages["rootNavigation"]; icon: LucideIcon; exact?: boolean };
type NavGroup = { key: string; label: keyof Messages["rootNavigation"]; icon: LucideIcon; items: NavLink[] };
type NavEntry = NavLink | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return Array.isArray((entry as NavGroup).items);
}

const NAV: NavEntry[] = [
  { href: "/root", label: "organizations", icon: LayoutDashboard, exact: true },
  {
    key: "money",
    label: "money",
    icon: Wallet,
    items: [
      { href: "/root/funnel", label: "funnel", icon: Filter },
      { href: "/root/tariffs", label: "tariffs", icon: Wallet },
      { href: "/root/promotions", label: "promotions", icon: BadgePercent },
      { href: "/root/promo-codes", label: "promoCodes", icon: Ticket },
      { href: "/root/proposals", label: "proposals", icon: FileText },
      { href: "/root/mailing", label: "mailing", icon: Mail },
      { href: "/root/services", label: "services", icon: Sparkles },
      { href: "/root/service-requests", label: "serviceRequests", icon: ClipboardList },
      { href: "/root/blank-downloads", label: "blankDownloads", icon: FileDown },
      { href: "/root/partners", label: "partners", icon: Handshake },
      { href: "/root/requisites", label: "requisites", icon: Stamp },
      { href: "/root/edo", label: "edo", icon: FileSignature },
    ],
  },
  {
    key: "voice",
    label: "voice",
    icon: MessageSquareText,
    items: [
      { href: "/root/feedback", label: "feedback", icon: MessageSquareText },
      { href: "/root/reviews", label: "reviews", icon: Star },
      { href: "/root/ideas", label: "ideas", icon: Lightbulb },
      { href: "/root/nps", label: "nps", icon: Smile },
      { href: "/root/assistant", label: "assistant", icon: Bot },
    ],
  },
  {
    key: "site",
    label: "site",
    icon: NotebookText,
    items: [
      { href: "/root/blog", label: "blog", icon: NotebookText },
      { href: "/root/seo", label: "seo", icon: SearchCheck },
      { href: "/root/yandex-direct", label: "yandexDirect", icon: Megaphone },
      { href: "/root/translations", label: "translations", icon: Languages },
    ],
  },
  {
    key: "platform",
    label: "platform",
    icon: Activity,
    items: [
      { href: "/root/status", label: "status", icon: Activity },
      { href: "/root/health", label: "health", icon: HeartPulse },
      { href: "/root/telegram-logs", label: "telegramLogs", icon: ScrollText },
      { href: "/root/audit", label: "audit", icon: FileClock },
      { href: "/root/audit-impersonations", label: "impersonation", icon: UserCog },
      { href: "/root/timings", label: "timings", icon: Timer },
      { href: "/root/page-limit", label: "pageLimit", icon: Gauge },
      { href: "/root/team", label: "team", icon: UsersRound },
    ],
  },
];

/**
 * Only what the person may open (2026-10-29, delegated access): the same
 * path rules as requireRoot(), so a hidden item is also a closed page.
 * A group with nothing left disappears.
 */
function navFor(viewer: PlatformViewer): NavEntry[] {
  const allowed = (link: NavLink) => canAccessPlatformPath(viewer, link.href);
  return NAV.flatMap<NavEntry>((entry) => {
    if (!isGroup(entry)) return allowed(entry) ? [entry] : [];
    const items = entry.items.filter(allowed);
    return items.length ? [{ ...entry, items }] : [];
  });
}

function isLinkActive(pathname: string, link: NavLink): boolean {
  return link.exact
    ? pathname === link.href
    : pathname === link.href || pathname.startsWith(`${link.href}/`);
}

/** Кнопка верхнего уровня на тёмной шапке. */
const TRIGGER_CLASS =
  "inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-2xl px-3 text-[14px] text-white/75 transition-colors duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/20";

const TRIGGER_ACTIVE_CLASS = "bg-white/10 font-medium text-white";

export function RootNav({ viewer }: { viewer: PlatformViewer }) {
  const t = useTranslations("rootNavigation");
  const nav = navFor(viewer);
  const pathname = usePathname();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Escape закрывает раскрытую группу: панель держится ещё и на CSS-hover,
  // но с клавиатуры выйти из неё иначе нечем.
  useEffect(() => {
    if (!openKey) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenKey(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openKey]);

  return (
    <>
      {/* Компьютер: ряд из шести элементов. */}
      <nav
        aria-label={t("navigationLabel")}
        className="hidden flex-wrap items-center gap-1 md:flex"
      >
        {nav.map((entry) => {
          if (!isGroup(entry)) {
            const active = isLinkActive(pathname, entry);
            return (
              <Link
                key={entry.href}
                href={entry.href}
                aria-current={active ? "page" : undefined}
                className={cn(TRIGGER_CLASS, active && TRIGGER_ACTIVE_CLASS)}
              >
                <entry.icon className="size-4 shrink-0" />
                {t(entry.label)}
              </Link>
            );
          }

          const groupActive = entry.items.some((item) => isLinkActive(pathname, item));
          const open = openKey === entry.key;
          return (
            <div
              key={entry.key}
              className="group/nav relative"
              onPointerLeave={() => setOpenKey((current) => (current === entry.key ? null : current))}
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenKey(open ? null : entry.key)}
                className={cn(
                  TRIGGER_CLASS,
                  "relative z-10",
                  groupActive && TRIGGER_ACTIVE_CLASS,
                )}
              >
                <entry.icon className="size-4 shrink-0" />
                {t(entry.label)}
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0 opacity-60 transition-transform duration-150 group-hover/nav:rotate-180 group-focus-within/nav:rotate-180",
                    open && "rotate-180",
                  )}
                />
              </button>

              <div
                role="menu"
                onClick={() => setOpenKey(null)}
                className={cn(
                  "absolute left-0 top-full z-30 w-[264px] translate-y-[-4px] transition-[opacity,transform] duration-150",
                  "pointer-events-none invisible opacity-0",
                  "group-hover/nav:pointer-events-auto group-hover/nav:visible group-hover/nav:translate-y-0 group-hover/nav:opacity-100",
                  "group-focus-within/nav:pointer-events-auto group-focus-within/nav:visible group-focus-within/nav:translate-y-0 group-focus-within/nav:opacity-100",
                  open && "pointer-events-auto visible translate-y-0 opacity-100",
                  MENU_PANEL_CLASS,
                  MENU_PANEL_PADDING_CLASS,
                )}
              >
                {entry.items.map((item) => {
                  const active = isLinkActive(pathname, item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      aria-current={active ? "page" : undefined}
                      className={cn(MENU_ITEM_CLASS, active && MENU_ITEM_ACTIVE_CLASS)}
                    >
                      <item.icon className="size-4 shrink-0" />
                      {t(item.label)}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Телефон: тот же лист снизу, что во всём приложении. */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className={cn(TRIGGER_CLASS, "md:hidden")}
      >
        <Menu className="size-4 shrink-0" />
        {t("sections")}
      </button>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t("navigationLabel")}>
        <nav
          aria-label={t("navigationLabel")}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) setSheetOpen(false);
          }}
          className="flex flex-col gap-1"
        >
          {nav.map((entry) => {
            if (!isGroup(entry)) {
              const active = isLinkActive(pathname, entry);
              return (
                <Link
                  key={entry.href}
                  href={entry.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(SHEET_ROW_CLASS, active && "bg-[#eef1ff] font-medium text-[#3848c7]")}
                >
                  <entry.icon className="size-5 shrink-0 text-[#5566f6]" />
                  {t(entry.label)}
                </Link>
              );
            }
            return (
              <div key={entry.key}>
                <div className={SHEET_GROUP_LABEL_CLASS}>{t(entry.label)}</div>
                {entry.items.map((item) => {
                  const active = isLinkActive(pathname, item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        SHEET_ROW_CLASS,
                        active && "bg-[#eef1ff] font-medium text-[#3848c7]",
                      )}
                    >
                      <item.icon className="size-5 shrink-0 text-[#5566f6]" />
                      {t(item.label)}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </BottomSheet>
    </>
  );
}

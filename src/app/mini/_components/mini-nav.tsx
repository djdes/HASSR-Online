"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarCheck,
  ClipboardList,
  Home,
  LayoutGrid,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import {
  activeMiniNavHref,
  type MiniNavIcon,
  type MiniNavItem,
} from "@/app/mini/_lib/nav-items";
import { haptic } from "./use-haptic";

/**
 * Нижнее меню мини-приложения.
 *
 * Пункты приходят готовыми с сервера (`loadMiniShellData` →
 * `miniNavItems`): права уже известны из сессии, и первый кадр обязан
 * показать тот же набор, что и все следующие. Раньше меню дозагружало
 * права запросом и достраивало вкладки на лету — содержимое прыгало.
 *
 * Соответствие «имя иконки → компонент» держим здесь: функции через
 * границу RSC не передаются.
 */
const NAV_ICONS: Record<MiniNavIcon, LucideIcon> = {
  Home,
  ClipboardList,
  LayoutGrid,
  UserRound,
  CalendarCheck,
};

/**
 * Экраны входа: `/mini/login` и `/mini` (проверка Telegram, ошибка входа,
 * переадресация домой). Меню «Сегодня / Разделы / Профиль» там
 * бессмысленно — человек ещё не вошёл, и каждая вкладка вела бы обратно
 * на вход.
 */
function isSignInPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === "/mini" || normalized === "/mini/login";
}

export function MiniNav({ items }: { items: MiniNavItem[] }) {
  const pathname = usePathname();
  const activeHref = activeMiniNavHref(items, pathname);
  if (isSignInPath(pathname ?? "")) return null;

  // Белая карточка QR-страниц, активная вкладка залита индиго, как главная
  // кнопка; вкладки 56px в высоту, между ними 8px. Цвета — `.mini-nav-*`
  // в mini-theme.css.
  return (
    <nav
      aria-label="Разделы приложения"
      className="mini-nav-rail fixed inset-x-3"
      style={{
        bottom: "var(--mini-safe-b)",
        zIndex: "var(--mini-z-nav)",
      }}
    >
      <div className="mx-auto flex w-full max-w-lg items-stretch gap-2 p-1.5">
        {items.map((item) => {
          const isActive = item.href === activeHref;
          const Icon = NAV_ICONS[item.icon];
          return (
            <Link
              key={item.href}
              href={item.href}
              data-nav-href={item.href}
              aria-current={isActive ? "page" : undefined}
              onClick={() => {
                if (!isActive) haptic("selection");
              }}
              // Вкладок не больше четырёх — они делят ширину поровну и
              // помещаются целиком даже на экране 360 px, поэтому
              // горизонтальной прокрутки у меню нет.
              className="mini-nav-tab mini-press"
            >
              <Icon className="size-[22px]" strokeWidth={isActive ? 2.2 : 1.9} />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

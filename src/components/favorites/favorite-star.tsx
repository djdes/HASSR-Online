"use client";

import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Star, StarOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFavorites } from "@/components/favorites/favorites-context";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

/**
 * Звёздочка «в избранное» у пункта меню (владелец, 2026-11-23): появляется при
 * наведении мышью на строку (`group/fav`) и при фокусе с клавиатуры; у
 * страницы, которая уже в избранном, — закрашенная. На телефоне (нет
 * наведения) не показывается. Кладётся поверх правого края строки — соседи
 * не сдвигаются. Нет главной или адрес не из меню — ничего.
 */
export function FavoriteStar({
  href,
  label,
  className,
}: {
  href: string;
  /** Название пункта — для подписи диктору. */
  label: string;
  className?: string;
}) {
  const t = useTranslations("navigation.shell.favorites");
  const favorites = useFavorites();
  if (!favorites.enabled || !favorites.canStar(href)) return null;
  const active = favorites.isFavorite(href);
  const title = active ? t("remove", { name: label }) : t("add", { name: label });
  return (
    <button
      type="button"
      aria-label={title}
      aria-pressed={active}
      title={title}
      data-favorite-star={href}
      data-favorite={active ? "" : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void favorites.toggle(href);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
      className={cn(
        "pointer-events-none absolute top-1/2 right-1.5 z-10 hidden size-7 -translate-y-1/2 items-center justify-center rounded-lg bg-[var(--app-surface,#fff)] opacity-0 transition-opacity duration-150 [@media(hover:hover)]:flex group-hover/fav:pointer-events-auto group-hover/fav:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
        active ? "text-[#c27803]" : "text-[#9b9fb3] hover:text-[#c27803]",
        className,
      )}
    >
      <Star className={cn("size-4", active && "fill-current")} aria-hidden />
    </button>
  );
}

/**
 * Правая кнопка мыши у пункта левого меню (владелец, 2026-11-23): «Добавить в
 * избранное» / «Убрать из избранного» и «Открыть в новой вкладке». Без главной
 * или для адреса не из меню — обычное меню браузера (ничего не перехватываем).
 */
export function NavContextMenu({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  /** Ссылка пункта — становится областью правого клика. */
  children: ReactElement;
}) {
  const t = useTranslations("navigation.shell.favorites");
  const favorites = useFavorites();
  if (!favorites.enabled || !favorites.canStar(href)) return children;
  const active = favorites.isFavorite(href);
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent data-nav-context-menu={href} aria-label={label}>
        <ContextMenuItem onSelect={() => void favorites.toggle(href)} data-nav-context-favorite>
          {active ? <StarOff aria-hidden /> : <Star aria-hidden className="text-[#c27803]" />}
          {active ? t("removeShort") : t("addShort")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            window.open(href, "_blank", "noopener");
          }}
        >
          <ExternalLink aria-hidden />
          {t("openNewTab")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

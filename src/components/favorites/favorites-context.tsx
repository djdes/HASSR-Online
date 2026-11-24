"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { HOME_FAVORITES_MAX, favoriteCandidates } from "@/lib/home-page";
import { useAppNav } from "@/components/layout/app-nav-context";

/**
 * «Избранное» главной — одно на кабинет (владелец, 2026-11-23: «при наведении
 * на любое меню — звёздочка: добавить и снять из избранного на главной», у
 * пунктов левого меню — ещё правая кнопка мыши). Список живёт в аккаунте
 * (`PUT /api/me/home-favorites`); звёздочки меню, меню правой кнопки и
 * карточки главной читают и меняют его отсюда, поэтому всегда согласованы.
 * Звёздочки — только у тех, у кого есть главная (`canSeeHomePage`).
 */
export type FavoritesValue = {
  enabled: boolean;
  hrefs: string[];
  busy: boolean;
  /** Адрес можно закрепить: он есть в меню человека. */
  canStar: (href: string) => boolean;
  isFavorite: (href: string) => boolean;
  /** Добавить или убрать; полное избранное — подсказка, ничего не меняем. */
  toggle: (href: string) => Promise<void>;
  /** Сохранить весь список (главная: «×» у карточки, выбор из окна). */
  save: (next: string[]) => Promise<boolean>;
};

const DISABLED: FavoritesValue = {
  enabled: false,
  hrefs: [],
  busy: false,
  canStar: () => false,
  isFavorite: () => false,
  toggle: async () => {},
  save: async () => false,
};

const FavoritesContext = createContext<FavoritesValue>(DISABLED);

export function FavoritesProvider({
  enabled,
  initial,
  children,
}: {
  enabled: boolean;
  initial: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const t = useTranslations("navigation.shell.favorites");
  const { sections } = useAppNav();
  const candidates = useMemo(() => new Set(favoriteCandidates(sections).map((candidate) => candidate.href)), [sections]);
  const [hrefs, setHrefs] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);
  // Сервер прислал новый список (обновление страницы) — берём его.
  const initialKey = initial.join("\n");
  const [syncedKey, setSyncedKey] = useState(initialKey);
  if (initialKey !== syncedKey) {
    setSyncedKey(initialKey);
    setHrefs(initial);
  }

  async function save(next: string[]): Promise<boolean> {
    const previous = hrefs;
    setHrefs(next);
    setBusy(true);
    try {
      const response = await fetch("/api/me/home-favorites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hrefs: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { hrefs: string[] };
      setHrefs(data.hrefs);
      router.refresh();
      return true;
    } catch {
      setHrefs(previous);
      toast.error(t("failed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggle(href: string) {
    if (busy) return;
    if (hrefs.includes(href)) {
      if (await save(hrefs.filter((entry) => entry !== href))) toast.success(t("removed"));
      return;
    }
    if (hrefs.length >= HOME_FAVORITES_MAX) {
      toast.error(t("full", { max: String(HOME_FAVORITES_MAX) }));
      return;
    }
    if (await save([...hrefs, href])) toast.success(t("added"));
  }

  const value: FavoritesValue = enabled
    ? {
        enabled: true,
        hrefs,
        busy,
        canStar: (href) => candidates.has(href),
        isFavorite: (href) => hrefs.includes(href),
        toggle,
        save,
      }
    : DISABLED;

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesValue {
  return useContext(FavoritesContext);
}

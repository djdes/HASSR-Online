"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { buildNewNav, type NewNav } from "@/lib/nav-layout";
import { useAppNav } from "@/components/layout/app-nav-context";
import { useViewPrefs } from "@/components/view-prefs/view-prefs-provider";

/**
 * Меню кабинета — шаблон «Новый» у всех, у кого меню есть (с 2026-11-11
 * он по умолчанию, переключатель «Вид меню» внизу слева убран).
 * Шаблон — только для компьютера (≥1024px): всё, что он добавляет или
 * прячет, помечено `lg:`-классами, телефон остаётся прежним.
 */
export function useNewNavLayout(): boolean {
  const { prefs } = useViewPrefs();
  const { showSidebar } = useAppNav();
  return showSidebar && prefs.navLayout === "new";
}

/** Где человек в шаблоне «Новый»: один расчёт на сайдбар, строку и крошки. */
export function useNewNavPlace(): NewNav {
  const { sections } = useAppNav();
  const pathname = usePathname() || "/";
  return useMemo(() => buildNewNav(sections, pathname), [sections, pathname]);
}

"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { getNativeBridge, statusBarStyleForBackground } from "@/lib/native-bridge";

/**
 * Строка состояния в приложении WeSetup на страницах ВНЕ оболочки
 * мини-приложения: QR-страницы, удаление аккаунта, политика и другие
 * публичные страницы. Мост оболочки (`native-app-bridge.tsx`) туда не
 * монтируется, и значки оставались бы такими, какими их поставила
 * последняя страница оболочки, — белыми на белой шапке.
 *
 * Смотрим, какого цвета верх страницы, и ставим значки под него. Страницы
 * оболочки (`.mini-topbar`) не трогаем: там решает мост. Вне приложения
 * компонент ничего не делает.
 */
export function NativeStatusBar() {
  const pathname = usePathname();

  useEffect(() => {
    const bridge = getNativeBridge();
    if (!bridge) return;

    let last: string | null = null;
    const apply = () => {
      if (document.querySelector(".mini-topbar")) return;
      let el: Element | null = document.elementFromPoint(Math.round(window.innerWidth / 2), 2);
      let style: "DARK" | "LIGHT" | null = null;
      while (el && !style) {
        style = statusBarStyleForBackground(getComputedStyle(el).backgroundColor);
        el = el.parentElement;
      }
      style ??= statusBarStyleForBackground(getComputedStyle(document.body).backgroundColor) ?? "LIGHT";
      if (style === last) return;
      last = style;
      void bridge.call("StatusBar", "setStyle", { style }).catch(() => undefined);
    };

    // Первый кадр и после догрузки шапки; тему страница может сменить сама.
    const timers = [window.setTimeout(apply, 50), window.setTimeout(apply, 600)];
    const observer = new MutationObserver(apply);
    for (const node of [document.documentElement, document.body]) {
      observer.observe(node, { attributes: true, attributeFilter: ["class", "data-theme", "data-app-theme"] });
    }
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}

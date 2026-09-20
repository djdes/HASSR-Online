"use client";

import { useEffect } from "react";

import {
  buildMiniShellClearCookie,
  hasMiniShellCookie,
} from "@/lib/mini-shell-cookie";

/**
 * Снимает режим оболочки мини-приложения.
 *
 * Стоит на странице входа сайта: если человек дошёл до формы с паролем,
 * значит он в обычном браузере, а не в Telegram — и кабинет после входа
 * должен открыться сайтом. Иначе кука, оставшаяся с чужого телефона или
 * с прошлой сессии, встретила бы его мобильной оболочкой на мониторе.
 *
 * Ничего не рендерит и перезагрузку не делает: страница входа хрома
 * кабинета не имеет, и менять на ней нечего.
 */
export function MiniShellReset() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!hasMiniShellCookie(document.cookie)) return;
    document.cookie = buildMiniShellClearCookie(
      window.location.protocol === "https:"
    );
  }, []);
  return null;
}

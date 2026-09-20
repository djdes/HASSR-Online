"use client";

import { useEffect, useState } from "react";

import { hasMiniShellCookie } from "@/lib/mini-shell-cookie";

/**
 * Страница показана внутри оболочки мини-приложения?
 *
 * Признаков два и они равноправны: сессионная кука `ws-shell=mini` и
 * присутствие `#mini-root` в разметке. Нужно тем редким местам, где
 * поведение обязано отличаться — например, внешние ссылки: тап по
 * ссылке на чужой сайт выбрасывает человека из Telegram, и посреди
 * незаполненной анкеты это потеря работы.
 *
 * Значение считается ПОСЛЕ гидрации (кука видна только браузеру),
 * поэтому первый кадр всегда «обычный сайт».
 */
export function useInAppShell(): boolean {
  const [inShell, setInShell] = useState(false);
  useEffect(() => {
    // Легитимный hydration-паттерн: значение читается из DOM/куки, то
    // есть из внешней системы, и только один раз после монтирования.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInShell(
      hasMiniShellCookie(document.cookie) ||
        document.getElementById("mini-root") !== null
    );
  }, []);
  return inShell;
}

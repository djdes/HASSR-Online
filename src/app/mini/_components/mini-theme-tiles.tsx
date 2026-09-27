"use client";

import { ThemeTileGroup, useThemeTileChoice } from "@/components/theme/theme-tiles";

import { useMiniTheme } from "./mini-theme";

/**
 * Тема в профиле мини-приложения — те же три карточки, что в меню профиля
 * сайта: «Светлая», «Тёмная», «Как на устройстве» (как блок Appearance в
 * приложении Claude). Нажал — тема сменилась сразу.
 *
 * Состояние — `useMiniTheme()`: «Как на устройстве» в Telegram следует теме
 * Telegram, в приложении WeSetup и в браузере — теме телефона. Выбор общий
 * с сайтом (те же ключи localStorage и профиль), смену по времени суток,
 * включённую на сайте, карточки уважают так же, как там: ни одна не
 * выбрана, подсказка, нажатие её выключает.
 */
export function MiniThemeTiles({ className }: { className?: string }) {
  const choice = useThemeTileChoice(useMiniTheme());
  return (
    <ThemeTileGroup
      value={choice.selected}
      onChange={choice.choose}
      note={choice.note}
      size="touch"
      tileClassName="mini-press"
      className={className}
    />
  );
}

"use client";

import { useSiteTheme, type ThemeMode } from "./site-theme";
import { ThemeTiles } from "./theme-tiles";

/**
 * Тема на странице «Настройки → Внешний вид»: те же три карточки, что в
 * меню профиля (`ThemeTiles`), плюс галочка «менять по времени суток».
 *
 * Карточки одинаковые везде, чтобы человек не встречал одну настройку в
 * двух разных видах и с разными подписями. Подсказку про авто-смену
 * карточки здесь не показывают — её роль играет сама галочка ниже:
 * нажатие на карточку снимает её у человека на глазах.
 */
export function ThemeModeControls({ className }: { className?: string }) {
  const { autoBySchedule, setAutoBySchedule } = useSiteTheme();

  return (
    <div className={className}>
      <ThemeTiles autoNote={false} />

      <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl px-2 py-2 hover:bg-[#fafbff]">
        <input
          type="checkbox"
          checked={autoBySchedule}
          onChange={(e) => setAutoBySchedule(e.target.checked)}
          className="mt-0.5 size-4 cursor-pointer accent-[#5566f6]"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[#0b1024]">
            Менять по времени суток
          </div>
          <div className="mt-0.5 text-[12px] leading-[1.4] text-[#6f7282]">
            7:00–19:00 — светлая, остальное — тёмная. Выбор карточки
            выключает эту настройку.
          </div>
        </div>
      </label>
    </div>
  );
}

/** ThemeMode pass-through, чтобы импортёры могли пробрасывать тип без site-theme. */
export type { ThemeMode };

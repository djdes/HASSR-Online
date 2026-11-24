import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Ручка листа снизу — одна на весь сайт (владелец, 2026-11-23: «при тапе
 * полоска превращается в стрелку вниз, отпустил — опять полоска, как в
 * приложении»). Полоска из двух половин: пока палец на ручке или лист тянут
 * вниз, половины складываются в стрелку; отпустили — снова полоска. Рисунок и
 * движение — в `src/app/motion.css` (раздел 11), по атрибуту
 * `data-sheet-grabber`.
 *
 * • в потоке (по умолчанию) — первой строкой листа, 24px высоты;
 * • `float` — абсолютно, по центру верхнего края, не сдвигая шапку окна.
 *
 * Состояние «лист тянут» ставит тот, кто ведёт жест: `data-pulled` (пустое —
 * тянут, `armed` — дальше порога, отпускание закроет лист). Самодельным окнам
 * ручку и жест даёт `motion-presence.ts`; этот компонент — для листов, которые
 * рисуют ручку сами (`Dialog`, `BottomSheet`, мастер регистрации).
 */
export function SheetGrabber({
  float = false,
  pulled,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  float?: boolean;
  /** `true` — лист тянут, `"armed"` — дальше порога закрытия. */
  pulled?: boolean | "armed";
}) {
  return (
    <div
      aria-hidden
      data-sheet-grabber={float ? "float" : ""}
      data-pulled={pulled === "armed" ? "armed" : pulled ? "" : undefined}
      className={cn(className)}
      {...props}
    />
  );
}

import { Loader2 } from "lucide-react";

/**
 * Граница Suspense для корня мини-приложения.
 *
 * Корень теперь — только вход: скелетона «главной» больше нет, потому
 * что главной нет и самой. Показываем ту же спокойную заставку, что и
 * сама страница, чтобы между тапом и кабинетом не мигал белый экран.
 */
export default function MiniLoading() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <Loader2
        className="size-7 animate-spin"
        style={{ color: "var(--mini-accent)" }}
      />
      <div className="text-[18px] font-semibold" style={{ color: "var(--mini-text)" }}>
        Открываем кабинет…
      </div>
    </div>
  );
}

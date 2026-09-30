"use client";

import { Loader2 } from "lucide-react";
import { usePathname } from "next/navigation";

import { MiniListSkeleton } from "@/app/mini/_components/mini-list-skeleton";
import { isSectionRoot } from "@/components/ui/skeleton-routes";

/**
 * Граница Suspense для `/mini/*`.
 *
 * Корень `/mini` — только вход: пока он решает, куда вести, показываем ту
 * же спокойную заставку, что и сама страница. Этот же `loading.tsx` —
 * запасной для ВСЕХ экранов приложения (своих у большинства нет), и раньше
 * каждое переключение вкладки нижнего меню показывало «Открываем кабинет…»
 * с крутилкой по центру. Теперь экранам — скелет списка, как у «Сегодня».
 */
export default function MiniLoading() {
  if (!isSectionRoot(usePathname(), "/mini")) {
    return <MiniListSkeleton />;
  }
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

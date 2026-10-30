"use client";

import { createContext, useCallback, useContext, useMemo, useOptimistic, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SkeletonList } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Отклик фильтра по местам (2026-10-29). Чипы — ссылки `?place=…`: меняется
 * только запрос, сегмент тот же, и `loading.tsx` не показывается — список
 * секунды стоял старым без признака загрузки. Теперь нажатие на чип — переход
 * в `useTransition`: чип отмечается сразу, список (`PlaceFilterResults`) —
 * скелет, пока не придут данные; чипы остаются кликабельными.
 *
 * `PlaceFilterScope` оборачивает чипы и список на странице; без него чипы
 * работают как обычные ссылки.
 */

type PlaceFilterState = {
  isPending: boolean;
  /** Чип, на который только что нажали (до прихода данных). */
  optimistic: string | undefined;
  select: (value: string, href: string) => void;
};

const PlaceFilterContext = createContext<PlaceFilterState | null>(null);

export function PlaceFilterScope({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic<string | undefined>(undefined);
  const select = useCallback(
    (value: string, href: string) => {
      startTransition(() => {
        setOptimistic(value);
        router.push(href, { scroll: false });
      });
    },
    [router, setOptimistic],
  );
  const value = useMemo(() => ({ isPending, optimistic, select }), [isPending, optimistic, select]);
  return <PlaceFilterContext.Provider value={value}>{children}</PlaceFilterContext.Provider>;
}

const CHIP =
  "inline-flex h-9 max-w-full items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/** Чип фильтра: отмечается сразу по нажатию, переход — без прокрутки наверх. */
export function PlaceChipLink({
  href,
  value,
  selected,
  count,
  children,
}: {
  href: string;
  /** Значение `?place=` этого чипа (`all`, `none`, id). */
  value: string;
  /** Отмечен по данным сервера. */
  selected: boolean;
  count: number;
  children: React.ReactNode;
}) {
  const scope = useContext(PlaceFilterContext);
  const isSelected = scope?.optimistic !== undefined ? scope.optimistic === value : selected;
  return (
    <Link
      href={href}
      scroll={false}
      onClick={(event) => {
        // Новая вкладка, окно, скачивание — как у обычной ссылки.
        if (!scope || event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (!isSelected) scope.select(value, href);
      }}
      className={cn(
        CHIP,
        isSelected
          ? "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
          : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
      )}
      aria-current={isSelected ? "true" : undefined}
      data-place-chip={value}
    >
      {children}
      <span className={cn("tabular-nums", isSelected ? "text-white/80" : "text-[#9b9fb3]")}>{count}</span>
    </Link>
  );
}

/**
 * Список под фильтром: пока данные места не пришли — скелет строк, сам список
 * скрыт, но не размонтирован. `className` — отступы между детьми списка.
 */
export function PlaceFilterResults({
  children,
  className,
  rows = 4,
}: {
  children: React.ReactNode;
  className?: string;
  rows?: number;
}) {
  const t = useTranslations("navigation.shell");
  const pending = useContext(PlaceFilterContext)?.isPending ?? false;
  return (
    <div data-place-results aria-busy={pending || undefined}>
      {pending ? (
        <div data-place-results-pending>
          <span className="sr-only" aria-live="polite">
            {t("listLoading")}
          </span>
          <SkeletonList rows={rows} height={72} />
        </div>
      ) : null}
      <div className={cn(pending ? "hidden" : className)}>{children}</div>
    </div>
  );
}

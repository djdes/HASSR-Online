import { cn } from "@/lib/utils";

/**
 * Скелетон загрузки — плашка с «шиммером»: по подложке бежит светлый
 * блик, как в лентах YouTube и Instagram. Раньше здесь был
 * `animate-pulse` (мигание всей плашки) — на медленном интернете это
 * читалось как ошибка отрисовки, а не как загрузка.
 *
 * Анимация и цвета живут в CSS (`.skeleton-shimmer` в globals.css,
 * токены `--app-skeleton-*` в app-theme.css), поэтому скелетон
 * одинаково правильно выглядит в светлой и тёмной теме и уважает
 * «уменьшить движение» в системе.
 *
 * Пример:
 *   <Suspense fallback={<SkeletonList rows={5} />}>
 *     <JournalList />
 *   </Suspense>
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("skeleton-shimmer rounded-md", className)}
      {...props}
    />
  );
}

/**
 * Несколько строк текста разной длины — последняя короче, как в
 * настоящем абзаце. `lines` по умолчанию 3.
 */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className="h-3 rounded-lg"
          style={{ width: index === lines - 1 ? "62%" : "100%" }}
        />
      ))}
    </div>
  );
}

/** Карточка списка: квадратная иконка, заголовок, две строки текста. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Skeleton className="size-11 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-[80%] rounded-lg" />
          <Skeleton className="h-3 w-[55%] rounded-lg" />
        </div>
      </div>
      <SkeletonText className="mt-5" lines={2} />
    </div>
  );
}

/** Список одинаковых строк — для лент и таблиц-карточек. */
export function SkeletonList({
  rows = 5,
  height = 64,
  className,
}: {
  rows?: number;
  height?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton
          key={index}
          className="w-full rounded-2xl"
          style={{ height }}
        />
      ))}
    </div>
  );
}

/**
 * Таблица журнала: шапка и строки в общей рамке. Ширины колонок
 * убывают — иначе плашки выглядят как одна серая простыня.
 */
export function SkeletonTable({
  rows = 8,
  columns = 6,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-[#ececf4] bg-white",
        className,
      )}
      aria-hidden
    >
      <div className="flex gap-3 border-b border-[#ececf4] bg-[#fafbff] px-4 py-3">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton
            key={index}
            className="h-3 rounded-lg"
            style={{ flex: index === 0 ? 2 : 1 }}
          />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div
          key={row}
          className="flex gap-3 border-b border-[#f3f4f9] px-4 py-3.5 last:border-b-0"
        >
          {Array.from({ length: columns }).map((_, index) => (
            <Skeleton
              key={index}
              className="h-3.5 rounded-lg"
              style={{ flex: index === 0 ? 2 : 1 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Шапка страницы: заголовок, подпись и пара кнопок справа. */
export function SkeletonPageHeader({
  className,
  actions = true,
}: {
  className?: string;
  /** Кнопки справа от заголовка — как у настоящей страницы. */
  actions?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3",
        className,
      )}
    >
      <div className="min-w-0 space-y-2">
        <Skeleton className="h-7 w-[240px] max-w-full rounded-xl" />
        <Skeleton className="h-3.5 w-[380px] max-w-full rounded-lg" />
      </div>
      {actions ? (
        <div className="flex gap-2">
          <Skeleton className="h-10 w-[130px] rounded-2xl" />
          <Skeleton className="h-10 w-[104px] rounded-2xl" />
        </div>
      ) : null}
    </div>
  );
}

/** Карточка-панель со строками «подпись + поле/значение» — формы и списки настроек. */
export function SkeletonPanel({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "space-y-5 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6",
        className,
      )}
    >
      <div className="space-y-2">
        <Skeleton className="h-4 w-48 rounded-lg" />
        <Skeleton className="h-3 w-72 max-w-full rounded-lg" />
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton
            className="h-3 rounded-lg"
            style={{ width: `${[28, 36, 22, 32, 26][index % 5]}%` }}
          />
          <Skeleton className="h-11 w-full rounded-2xl" />
        </div>
      ))}
    </div>
  );
}

/**
 * Скелетон целой страницы кабинета — ОДИН на все новые `loading.tsx`, чтобы
 * загрузка везде выглядела одинаково: шапка как у `PageHeader`, при желании
 * плитки-счётчики (2 в ряд на телефоне, 4 на компьютере) и тело —
 * карточки, строки списка, таблица или панель-форма. Цвета — токены
 * `--app-skeleton-*`, поэтому одинаково в светлой и тёмной теме.
 *
 * `label` — для экранного диктора: «Загружаем …».
 */
export function PageSkeleton({
  label,
  body = "cards",
  items,
  stats = 0,
  actions = true,
  className,
}: {
  label: string;
  body?: "cards" | "list" | "table" | "panel";
  /** Сколько карточек / строк / строк таблицы / полей. */
  items?: number;
  /** Плитки-счётчики под шапкой. */
  stats?: number;
  actions?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("space-y-5", className)}
      aria-busy="true"
      aria-live="polite"
      data-page-skeleton={body}
    >
      <span className="sr-only">{label}</span>
      <SkeletonPageHeader actions={actions} />
      {stats > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: stats }).map((_, index) => (
            <Skeleton key={index} className="h-[74px] rounded-2xl" />
          ))}
        </div>
      ) : null}
      {body === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: items ?? 6 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      ) : body === "list" ? (
        <SkeletonList rows={items ?? 6} height={72} />
      ) : body === "table" ? (
        <SkeletonTable rows={items ?? 8} />
      ) : (
        <SkeletonPanel rows={items ?? 5} />
      )}
    </div>
  );
}

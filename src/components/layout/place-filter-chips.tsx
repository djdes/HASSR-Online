import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Briefcase, Store } from "lucide-react";

import { PLACE_ALL, PLACE_NONE } from "@/lib/place-filter";
import { cn } from "@/lib/utils";

export type PlaceChip = { id: string; name: string; office: boolean; count: number };

/**
 * Фильтр по местам над списком — один вид на всех вкладках «Торговых
 * точек» (2026-10-28: сотрудники, журналы точек, цеха, оборудование).
 * «Все», офис, каждая точка и «Без точки» со счётчиками. Ссылки, а не
 * состояние клиента: выбор в адресе (`?place=`), его можно открыть ссылкой.
 * Отмеченное место считает `resolvePlaceFilter` (`src/lib/place-filter.ts`).
 */
export function PlaceFilterChips(props: {
  /** Подпись слева: «Где работает», «Точка». */
  label: string;
  /** Адрес страницы без параметров. */
  basePath: string;
  /** Отмеченное место: id, `none` или null — «Все». */
  active: string | null;
  all: { label: string; count: number; icon: LucideIcon };
  places: PlaceChip[];
  /** «Без точки» / «Без места»; без объектов без места — не показываем. */
  none?: { label: string; count: number; icon: LucideIcon } | null;
  /** Метка списка для проверок: `data-place-filter`. */
  kind: string;
}) {
  const chip = (selected: boolean) =>
    cn(
      "inline-flex h-9 max-w-full items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
      selected
        ? "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
        : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
    );
  const count = (value: number, selected: boolean) => (
    <span className={cn("tabular-nums", selected ? "text-white/80" : "text-[#9b9fb3]")}>{value}</span>
  );
  const href = (value: string) => `${props.basePath}?place=${encodeURIComponent(value)}`;
  const AllIcon = props.all.icon;
  const NoneIcon = props.none?.icon;

  return (
    <nav aria-label={props.label} className="flex flex-col gap-2 sm:flex-row sm:items-start" data-place-filter={props.kind}>
      <span className="pt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3] sm:shrink-0">{props.label}</span>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        <Link
          href={href(PLACE_ALL)}
          className={chip(props.active === null)}
          aria-current={props.active === null ? "true" : undefined}
          data-place-chip={PLACE_ALL}
        >
          <AllIcon className="size-3.5 shrink-0" aria-hidden />
          {props.all.label}
          {count(props.all.count, props.active === null)}
        </Link>
        {props.places.map((place) => {
          const selected = props.active === place.id;
          const Icon = place.office ? Briefcase : Store;
          return (
            <Link
              key={place.id}
              href={href(place.id)}
              className={chip(selected)}
              aria-current={selected ? "true" : undefined}
              data-place-chip={place.id}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{place.name}</span>
              {count(place.count, selected)}
            </Link>
          );
        })}
        {props.none && NoneIcon ? (
          <Link
            href={href(PLACE_NONE)}
            className={chip(props.active === PLACE_NONE)}
            aria-current={props.active === PLACE_NONE ? "true" : undefined}
            data-place-chip={PLACE_NONE}
          >
            <NoneIcon className="size-3.5 shrink-0" aria-hidden />
            {props.none.label}
            {count(props.none.count, props.active === PLACE_NONE)}
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

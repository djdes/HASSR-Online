import type { LucideIcon } from "lucide-react";
import { Briefcase, Store } from "lucide-react";

import { PLACE_ALL, PLACE_NONE } from "@/lib/place-filter";
import { PlaceChipLink } from "@/components/layout/place-filter-scope";

export type PlaceChip = { id: string; name: string; office: boolean; count: number };

/**
 * Фильтр по местам над списком — один вид на всех вкладках «Торговых
 * точек» (2026-10-28: сотрудники, журналы точек, цеха, оборудование).
 * «Все», офис, каждая точка и «Без точки» со счётчиками. Ссылки, а не
 * состояние клиента: выбор в адресе (`?place=`), его можно открыть ссылкой.
 * Отмеченное место считает `resolvePlaceFilter` (`src/lib/place-filter.ts`).
 *
 * С 2026-10-29 чип — `PlaceChipLink`: внутри `PlaceFilterScope` нажатие
 * отмечает чип сразу, а список (`PlaceFilterResults`) показывает скелет до
 * прихода данных. Иконки рисуются здесь, на сервере: компонент иконки в
 * клиентский чип не передаётся.
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
  const href = (value: string) => `${props.basePath}?place=${encodeURIComponent(value)}`;
  const AllIcon = props.all.icon;
  const NoneIcon = props.none?.icon;

  return (
    <nav aria-label={props.label} className="flex flex-col gap-2 sm:flex-row sm:items-start" data-place-filter={props.kind}>
      <span className="pt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3] sm:shrink-0">{props.label}</span>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        <PlaceChipLink href={href(PLACE_ALL)} value={PLACE_ALL} selected={props.active === null} count={props.all.count}>
          <AllIcon className="size-3.5 shrink-0" aria-hidden />
          {props.all.label}
        </PlaceChipLink>
        {props.places.map((place) => {
          const Icon = place.office ? Briefcase : Store;
          return (
            <PlaceChipLink
              key={place.id}
              href={href(place.id)}
              value={place.id}
              selected={props.active === place.id}
              count={place.count}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{place.name}</span>
            </PlaceChipLink>
          );
        })}
        {props.none && NoneIcon ? (
          <PlaceChipLink
            href={href(PLACE_NONE)}
            value={PLACE_NONE}
            selected={props.active === PLACE_NONE}
            count={props.none.count}
          >
            <NoneIcon className="size-3.5 shrink-0" aria-hidden />
            {props.none.label}
          </PlaceChipLink>
        ) : null}
      </div>
    </nav>
  );
}

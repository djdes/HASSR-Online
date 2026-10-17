import { MapPin, Store } from "lucide-react";

/**
 * Заголовок группы «точка» на страницах «Цеха и участки» и «Оборудование»
 * (2026-10-17): точка → её помещения → оборудование. `building = null` —
 * группа «Без точки»: такие цеха видны на каждой точке.
 */
export function BuildingGroupHeader({
  building,
  countLabel,
  looseHint,
}: {
  building: { name: string; address?: string | null } | null;
  /** «3 цеха», «5 единиц» — уже со словом. */
  countLabel: string;
  /** Подсказка под «Без точки»: что сделать, чтобы цех ушёл в точку. */
  looseHint?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 px-1">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
            building ? "bg-[#eef1ff] text-[#5566f6]" : "bg-[#f5f6fa] text-[#6f7282]"
          }`}
        >
          {building ? <Store className="size-[18px]" /> : <MapPin className="size-[18px]" />}
        </span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]">
            {building ? building.name : "Без точки"}
          </h2>
          {building?.address ? (
            <p className="mt-0.5 text-[13px] text-[#6f7282]">{building.address}</p>
          ) : !building && looseHint ? (
            <p className="mt-0.5 max-w-[560px] text-[13px] leading-snug text-[#6f7282]">{looseHint}</p>
          ) : null}
        </div>
      </div>
      <span className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium tabular-nums text-[#3848c7]">
        {countLabel}
      </span>
    </div>
  );
}

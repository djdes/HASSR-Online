import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Briefcase, Store, UserX, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type StaffPlaceOption = { id: string; name: string; office: boolean; count: number };

/**
 * «Где работает» над списком сотрудников (2026-10-26): все, офис, каждая
 * точка, без места. Ссылки, а не состояние клиента: выбор попадает в адрес
 * (`?place=`), и со страницы точки или офиса можно сразу открыть их людей.
 */
export async function StaffPlaceFilter(props: {
  active: string | null;
  total: number;
  unplaced: number;
  places: StaffPlaceOption[];
}) {
  const t = await getTranslations("staffManagement.place");
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

  return (
    <nav aria-label={t("label")} className="flex flex-col gap-2 sm:flex-row sm:items-start" data-staff-place-filter>
      <span className="pt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3] sm:shrink-0">{t("label")}</span>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        <Link href="/settings/users" className={chip(props.active === null)} data-staff-place="all">
          <Users className="size-3.5 shrink-0" aria-hidden />
          {t("all")}
          {count(props.total, props.active === null)}
        </Link>
        {props.places.map((place) => {
          const selected = props.active === place.id;
          const Icon = place.office ? Briefcase : Store;
          return (
            <Link
              key={place.id}
              href={`/settings/users?place=${encodeURIComponent(place.id)}`}
              className={chip(selected)}
              data-staff-place={place.id}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{place.name}</span>
              {count(place.count, selected)}
            </Link>
          );
        })}
        {props.unplaced > 0 ? (
          <Link href="/settings/users?place=none" className={chip(props.active === "none")} data-staff-place="none">
            <UserX className="size-3.5 shrink-0" aria-hidden />
            {t("none")}
            {count(props.unplaced, props.active === "none")}
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

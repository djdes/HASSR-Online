import { getTranslations } from "next-intl/server";
import { UserX, Users } from "lucide-react";

import { PlaceFilterChips, type PlaceChip } from "@/components/layout/place-filter-chips";

export type StaffPlaceOption = PlaceChip;

/**
 * «Где работает» над списком сотрудников (2026-10-26): все, офис, каждая
 * точка, без места. Тот же фильтр — на «Журналах точек», «Цехах» и
 * «Оборудовании» (`PlaceFilterChips`, 2026-10-28). Выбор — в адресе
 * (`?place=`), со страницы точки или офиса можно сразу открыть их людей.
 */
export async function StaffPlaceFilter(props: {
  active: string | null;
  total: number;
  unplaced: number;
  places: StaffPlaceOption[];
}) {
  const t = await getTranslations("staffManagement.place");
  return (
    <PlaceFilterChips
      kind="staff"
      label={t("label")}
      basePath="/settings/users"
      active={props.active}
      all={{ label: t("all"), count: props.total, icon: Users }}
      places={props.places}
      none={props.unplaced > 0 ? { label: t("none"), count: props.unplaced, icon: UserX } : null}
    />
  );
}

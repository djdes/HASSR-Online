import type { Session } from "next-auth";

import { getViewedPointId } from "@/lib/active-building";
import { staffAtBuildingWhere } from "@/lib/building-settings";
import { staffScopeWhere } from "@/lib/point-scope";

/**
 * Люди в списках кабинета (2026-11-01, «точка видит только своё»):
 * руководитель точки — только люди его точек (`staffScopeWhere`), выбранная
 * в шапке точка — её люди и те, кто работает на всех точках
 * (`staffAtBuildingWhere`). «Вся организация» и выключенные точки — все.
 *
 * Условие для `db.user` (или `user: …` связанной записи); разворачивается
 * через spread и занимает только `AND` — верхний `OR` запроса не трогает.
 */
export async function visibleStaffWhere(session: Session) {
  const viewedPoint = await getViewedPointId(session);
  return { AND: [staffScopeWhere(session.user), staffAtBuildingWhere(viewedPoint)] };
}

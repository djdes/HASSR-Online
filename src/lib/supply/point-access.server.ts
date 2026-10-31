import type { Session } from "next-auth";

import { loadBuildingContext } from "@/lib/active-building";

import { supplyPointAccessFrom, type SupplyPointAccess } from "./supply-points";

/** Доступ к накладным по точкам для текущего запроса — см. `supplyPointAccessFrom`. */
export async function loadSupplyPointAccess(session: Session): Promise<SupplyPointAccess> {
  return supplyPointAccessFrom(await loadBuildingContext(session));
}

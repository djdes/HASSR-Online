import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { loadBuildingContext } from "@/lib/active-building";
import { viewedPointId } from "@/lib/building-scope";
import {
  BUILDING_OUT_OF_SCOPE_ERROR,
  COMPANY_ONLY_API_ERROR,
  buildingInScope,
  isPointScoped,
  type PointScopeActor,
} from "@/lib/point-scope";

/**
 * Где правятся настройки журналов (набор, автоматика, бракеражная комиссия),
 * 2026-11-01: точка из шапки (`viewedPointId`) или вся организация (null).
 * Раньше брали `getActiveBuildingId` — в режиме «Вся организация» это офис
 * или первая точка, и правка «всей организации» уходила одной точке.
 * Руководитель точки правит только свою точку, общее — офис.
 */
export type JournalSettingsTarget =
  | { ok: true; pointId: string | null }
  | { ok: false; status: 403; error: string };

export function resolveJournalSettingsTarget(args: {
  actor: PointScopeActor | null | undefined;
  viewedPointId: string | null;
}): JournalSettingsTarget {
  if (isPointScoped(args.actor)) {
    if (!args.viewedPointId) return { ok: false, status: 403, error: COMPANY_ONLY_API_ERROR };
    if (!buildingInScope(args.actor, args.viewedPointId)) {
      return { ok: false, status: 403, error: BUILDING_OUT_OF_SCOPE_ERROR };
    }
  }
  return { ok: true, pointId: args.viewedPointId };
}

/** Точка настроек для чтения: точка из шапки, null — вся организация. */
export async function journalSettingsPointId(session: Session): Promise<string | null> {
  return viewedPointId(await loadBuildingContext(session));
}

/** То же для записи: отказ руководителю точки вне его точек — готовый ответ. */
export async function journalSettingsWriteTarget(
  session: Session,
): Promise<{ ok: true; pointId: string | null } | { ok: false; response: NextResponse }> {
  const target = resolveJournalSettingsTarget({
    actor: session.user,
    viewedPointId: await journalSettingsPointId(session),
  });
  if (target.ok) return target;
  return { ok: false, response: NextResponse.json({ error: target.error }, { status: target.status }) };
}

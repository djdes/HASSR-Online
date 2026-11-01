import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { canHideInspectionVisits, inspectionVisitHideSchema, INSPECTION_VISIT_ERRORS } from "@/lib/inspection-visits";
import { inspectionVisitInArea } from "@/lib/checklist-point-scope";
import { visibleObjectBuildingIds } from "@/lib/point-objects.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Скрыть как ошибочную» и «Вернуть» запись журнала посещений.
 * POST JSON `{ hidden: true, reason }` | `{ hidden: false }` — руководитель
 * (`admin.full`), только своя организация. Запись не удаляется: журнал как
 * бумажный. Скрытая не показывается по умолчанию, не попадает в архив и
 * на портал проверяющего. Каждое действие — в журнал действий.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  if (!canHideInspectionVisits(session.user)) {
    return NextResponse.json({ error: "Скрыть запись может руководитель" }, { status: 403 });
  }
  const parsed = inspectionVisitHideSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? INSPECTION_VISIT_ERRORS.hideReason, field: "reason" }, { status: 400 });
  }
  const organizationId = getActiveOrgId(session);
  const { id } = await ctx.params;
  const visit = /^[A-Za-z0-9_-]{1,64}$/.test(id)
    ? await db.inspectionVisit.findUnique({
        where: { id },
        select: { id: true, organizationId: true, hiddenAt: true, inspectorName: true, authority: true, token: { select: { buildingId: true } } },
      })
    : null;
  // Точка (2026-11-01, «точка видит только своё»): запись по ссылке другой точки — «не найдена».
  if (!visit || visit.organizationId !== organizationId || !inspectionVisitInArea(await visibleObjectBuildingIds(session), visit.token?.buildingId)) {
    return NextResponse.json({ error: "Посещение не найдено" }, { status: 404 });
  }

  const { hidden, reason } = parsed.data;
  // Повтор того же действия — без изменений (двойной клик, вторая вкладка).
  if (hidden === (visit.hiddenAt !== null)) {
    return NextResponse.json({ ok: true, hidden, unchanged: true });
  }
  const updated = await db.inspectionVisit.update({
    where: { id: visit.id },
    data: hidden
      ? { hiddenAt: new Date(), hiddenById: session.user.id, hiddenByName: session.user.name ?? null, hiddenReason: reason }
      : { hiddenAt: null, hiddenById: null, hiddenByName: null, hiddenReason: null },
    select: { hiddenAt: true },
  });
  await recordAuditLog({
    request,
    session,
    organizationId,
    action: hidden ? "inspection_visit.hide" : "inspection_visit.unhide",
    entity: "InspectionVisit",
    entityId: visit.id,
    details: { inspectorName: visit.inspectorName, authority: visit.authority, ...(hidden ? { reason } : {}) },
  });
  return NextResponse.json({ ok: true, hidden: updated.hiddenAt !== null });
}

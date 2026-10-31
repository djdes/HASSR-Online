import { NextResponse, type NextRequest } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { worksAtBuilding } from "@/lib/building-scope";
import { buildingTargets } from "@/lib/building-targets";
import {
  cascadeResponsibleToActiveDocuments,
  resetPointResponsibles,
  type CascadeScope,
} from "@/lib/journal-responsibles-cascade";
import { getPrimarySlotId } from "@/lib/journal-responsible-schemas";
import { effectiveJournalSlots, loadEffectiveResponsibleSlots } from "@/lib/journal-responsibles-points";
import { buildingInScope, BUILDING_OUT_OF_SCOPE_ERROR, COMPANY_ONLY_API_ERROR, isPointScoped } from "@/lib/point-scope";
import { cascadeVerifierToTasksflow } from "@/lib/tasksflow-verifier-cascade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Session = Extract<Awaited<ReturnType<typeof requireApiAuth>>, { ok: true }>["session"];

/**
 * Точка запроса: id торговой точки организации или null (организация).
 * Руководитель точки меняет только свои точки и только их, не организацию.
 */
async function resolveTargetPoint(
  session: Session,
  organizationId: string,
  rawBuildingId: unknown,
): Promise<{ ok: true; pointId: string | null; orgBuildingIds: string[] } | { ok: false; response: NextResponse }> {
  const targets = await buildingTargets(organizationId);
  const orgBuildingIds = targets.filter((id): id is string => id !== null);
  const requested = typeof rawBuildingId === "string" && rawBuildingId.length > 0 ? rawBuildingId : null;
  if (requested && !orgBuildingIds.includes(requested)) {
    return { ok: false, response: NextResponse.json({ error: "Точка не найдена" }, { status: 400 }) };
  }
  if (isPointScoped(session.user)) {
    if (!requested) return { ok: false, response: NextResponse.json({ error: COMPANY_ONLY_API_ERROR }, { status: 403 }) };
    if (!buildingInScope(session.user, requested)) {
      return { ok: false, response: NextResponse.json({ error: BUILDING_OUT_OF_SCOPE_ERROR }, { status: 403 }) };
    }
  }
  return { ok: true, pointId: requested, orgBuildingIds };
}

/**
 * PUT /api/settings/journal-responsibles/<code>
 * Body: {
 *   positionIds: string[],
 *   slotUsers?: { [slotId: string]: string | null },
 *   scope?: "active-any" | "all",
 *   buildingId?: string   // ответственные точки (2026-10-31)
 * }
 *
 * Без точки:
 *   1. JobPositionJournalAccess — eligibility должностей для bulk-assign.
 *   2. Сохраняет slotUsers в Organization.journalResponsibleUsersJson
 *      (per-slot карта; у каждого журнала своя схема слотов).
 *   3. Каскадно проставляет ответственных документам журнала — каждому
 *      по его точке: своё точки или организации (кто работает на точке).
 * С точкой: только её ответственные (Building.journalResponsibleUsersJson)
 * и только её документы; должности — общие, их не трогаем.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { code } = await params;
  const organizationId = getActiveOrgId(session);

  const template = await db.journalTemplate.findUnique({
    where: { code },
    select: { id: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Журнал не найден" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const target = await resolveTargetPoint(session, organizationId, (body as { buildingId?: unknown } | null)?.buildingId);
  if (!target.ok) return target.response;
  const pointId = target.pointId;

  const positionIdsRaw = (body as { positionIds?: unknown } | null)?.positionIds;
  const requestedPositionIds: string[] = Array.isArray(positionIdsRaw)
    ? positionIdsRaw.filter(
        (p: unknown): p is string => typeof p === "string" && p.length > 0
      )
    : [];

  const slotUsersRaw = (body as { slotUsers?: unknown } | null)?.slotUsers;
  const slotUsers: Record<string, string | null> = {};
  if (slotUsersRaw && typeof slotUsersRaw === "object") {
    for (const [slotId, userId] of Object.entries(
      slotUsersRaw as Record<string, unknown>
    )) {
      if (typeof slotId !== "string") continue;
      slotUsers[slotId] =
        typeof userId === "string" && userId.length > 0 ? userId : null;
    }
  }

  // scope управляет глубиной каскада. UI делает 2 кнопки:
  //   • "Сохранить + изменить в активных" → scope="active-any" (по
  //     умолчанию для обычного сохранения).
  //   • "Сохранить + изменить во всех документах" → scope="all" с
  //     явным confirm-модальным окном.
  // Back-compat: если поле не передали — оставляем legacy "active-today".
  const scopeRaw = (body as { scope?: unknown } | null)?.scope;
  const scope: CascadeScope =
    scopeRaw === "all"
      ? "all"
      : scopeRaw === "active-any"
        ? "active-any"
        : "active-today";

  if (!pointId && requestedPositionIds.length > 0) {
    const owned = await db.jobPosition.findMany({
      where: { id: { in: requestedPositionIds }, organizationId },
      select: { id: true },
    });
    if (owned.length !== requestedPositionIds.length) {
      return NextResponse.json(
        { error: "Некоторые должности не принадлежат организации" },
        { status: 400 }
      );
    }
  }

  // Защита от подмены чужих userId; у точки — только её сотрудники.
  const userIds = Object.values(slotUsers).filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
  if (userIds.length > 0) {
    const owned = await db.user.findMany({
      where: {
        id: { in: userIds },
        organizationId,
        isActive: true,
        archivedAt: null,
      },
      select: { id: true, buildingIds: true },
    });
    if (owned.length !== new Set(userIds).size) {
      return NextResponse.json(
        { error: "Некоторые сотрудники не принадлежат организации" },
        { status: 400 }
      );
    }
    if (pointId && owned.some((user) => !worksAtBuilding(target.orgBuildingIds, user.buildingIds ?? [], pointId))) {
      return NextResponse.json(
        { error: "Ответственным точки можно выбрать только сотрудника этой точки" },
        { status: 400 }
      );
    }
  }

  // Должности — общие для организации: у точки остаются как есть.
  let positionIds = requestedPositionIds;
  if (pointId) {
    const rows = await db.jobPositionJournalAccess.findMany({
      where: { templateId: template.id, organizationId },
      select: { jobPositionId: true },
    });
    positionIds = rows.map((row) => row.jobPositionId);
  } else {
    await db.$transaction([
      db.jobPositionJournalAccess.deleteMany({
        where: { templateId: template.id, organizationId },
      }),
      ...(positionIds.length > 0
        ? [
            db.jobPositionJournalAccess.createMany({
              data: positionIds.map((jobPositionId) => ({
                templateId: template.id,
                organizationId,
                jobPositionId,
              })),
            }),
          ]
        : []),
    ]);
  }

  const cascade = await cascadeResponsibleToActiveDocuments({
    organizationId,
    templateId: template.id,
    journalCode: code,
    positionIds,
    slotUsers,
    scope,
    buildingId: pointId,
  });

  // Каскад на TasksFlow: если у журнала уже есть выпущенные задачи,
  // переписываем их verifier_worker_id на нового primary slot user.
  // Best-effort — TF может быть недоступен; не валим основной ответ.
  // scope="active-today" остаётся узким (legacy, без TF cascade);
  // active-any и all каскадируют на TF tasks соответственно. У точки —
  // её задачи; у организации — общие документы и каждая точка со своим
  // действующим ответственным.
  let tfCascade: Awaited<ReturnType<typeof cascadeVerifierToTasksflow>> | null =
    null;
  if (scope !== "active-today") {
    try {
      const tfScope = scope === "all" ? "all" : "active-any";
      if (pointId || target.orgBuildingIds.length === 0) {
        tfCascade = await cascadeVerifierToTasksflow({
          organizationId,
          journalCode: code,
          newPrimaryUserId: cascade.pickedPrimaryUserId,
          scope: tfScope,
          ...(pointId ? { buildingId: pointId } : {}),
        });
      } else {
        const primarySlotId = getPrimarySlotId(code);
        let report = await cascadeVerifierToTasksflow({
          organizationId,
          journalCode: code,
          newPrimaryUserId: cascade.pickedPrimaryUserId,
          scope: tfScope,
          buildingId: null,
        });
        for (const buildingId of target.orgBuildingIds) {
          const slots = await effectiveJournalSlots(organizationId, buildingId, code);
          const part = await cascadeVerifierToTasksflow({
            organizationId,
            journalCode: code,
            newPrimaryUserId: slots[primarySlotId] ?? null,
            scope: tfScope,
            buildingId,
          });
          report = {
            ...report,
            attempted: report.attempted + part.attempted,
            updated: report.updated + part.updated,
            errors: report.errors + part.errors,
          };
        }
        tfCascade = report;
      }
    } catch (err) {
      console.warn(
        "[journal-responsibles cascade] TF-side failed (non-fatal)",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    count: positionIds.length,
    documentsUpdated: cascade.documentsUpdated,
    slotUsers: cascade.savedSlots,
    buildingId: pointId,
    scope,
    tasksflow: tfCascade,
  });
}

/**
 * DELETE /api/settings/journal-responsibles/<code>?buildingId=<точка>
 * «Как у организации»: убрать своих ответственных точки по журналу и
 * проставить активным документам точки действующих.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const { code } = await params;
  const organizationId = getActiveOrgId(session);
  const target = await resolveTargetPoint(session, organizationId, request.nextUrl.searchParams.get("buildingId"));
  if (!target.ok) return target.response;
  if (!target.pointId) {
    return NextResponse.json({ error: "Выберите точку" }, { status: 400 });
  }
  const template = await db.journalTemplate.findUnique({ where: { code }, select: { id: true } });
  if (!template) {
    return NextResponse.json({ error: "Журнал не найден" }, { status: 404 });
  }
  const positions = await db.jobPositionJournalAccess.findMany({
    where: { templateId: template.id, organizationId },
    select: { jobPositionId: true },
  });
  const result = await resetPointResponsibles({
    organizationId,
    templateId: template.id,
    journalCode: code,
    buildingId: target.pointId,
    positionIds: positions.map((row) => row.jobPositionId),
  });
  const effective = await loadEffectiveResponsibleSlots(organizationId, target.pointId);
  return NextResponse.json({
    ok: true,
    documentsUpdated: result.documentsUpdated,
    slotUsers: result.slots,
    own: effective.ownCodes.has(code),
  });
}

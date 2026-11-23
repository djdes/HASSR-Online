import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { BUILDING_OUT_OF_SCOPE_ERROR, COMPANY_ONLY_API_ERROR, buildingInScope, isPointScoped } from "@/lib/point-scope";
import { closePointManagerSessions } from "@/lib/point-scope.server";
import { endAssignmentsAtBuilding } from "@/lib/point-assignments.server";
import { isOfficeBuilding } from "@/lib/building-scope";
import { OBJECT_CATEGORY_VALUES } from "@/lib/object-categories";
import { applyObjectCategoryJournals } from "@/lib/object-category-journals.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  address: z.string().trim().max(200).optional().nullable(),
  /// Точки: реквизиты точки для шапки PDF.
  kpp: z.string().trim().max(20).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  /// Наименование точки в шапке журналов (в интерфейсе — короткое name).
  journalName: z.string().trim().max(200).optional().nullable(),
  sortOrder: z.number().int().optional(),
  /** Сфера объекта (2026-11-23); у офиса её нет. */
  sphere: z.enum(OBJECT_CATEGORY_VALUES, { message: "Выберите сферу объекта" }).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

async function ensureOwn(orgId: string, buildingId: string) {
  const b = await db.building.findFirst({
    where: { id: buildingId, organizationId: orgId },
    select: { id: true },
  });
  return Boolean(b);
}

export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  const { id } = await ctx.params;
  if (!(await ensureOwn(orgId, id))) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  // Руководитель точки правит только свои точки (фаза 2 «Офис и точки»).
  if (!buildingInScope(auth.session.user, id)) {
    return NextResponse.json({ error: BUILDING_OUT_OF_SCOPE_ERROR }, { status: 403 });
  }

  let body: z.infer<typeof UpdateSchema>;
  try {
    body = UpdateSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad input" },
        { status: 400 }
      );
    }
    throw err;
  }

  // Сфера — только у объекта: офис организации объектом не считается.
  const before = await db.building.findUnique({ where: { id }, select: { kind: true, sphere: true } });
  const sphereChange =
    body.sphere !== undefined && before && !isOfficeBuilding(before) && before.sphere !== body.sphere
      ? body.sphere
      : null;

  const updated = await db.building.update({
    where: { id },
    data: {
      ...(sphereChange ? { sphere: sphereChange } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.address !== undefined ? { address: body.address } : {}),
      ...(body.kpp !== undefined ? { kpp: body.kpp || null } : {}),
      ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
      ...(body.journalName !== undefined
        ? { journalName: body.journalName?.replace(/\s+/g, " ").trim() || null }
        : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    },
  });
  // Новая сфера у существующего объекта — только включаем её обязательные
  // журналы (не выключая лишних): у объекта уже могут быть документы, и
  // выключенный журнал спрятал бы их.
  const journals = sphereChange
    ? await applyObjectCategoryJournals({
        organizationId: orgId,
        buildingId: id,
        category: sphereChange,
        reason: "change",
      }).catch((error) => {
        console.error("[buildings] sphere journals failed", error);
        return null;
      })
    : null;
  return NextResponse.json({ building: updated, journalsLimited: journals?.limited === true });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  const { id } = await ctx.params;
  if (!(await ensureOwn(orgId, id))) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  // Убрать точку — решение компании, не руководителя точки.
  if (isPointScoped(auth.session.user)) {
    return NextResponse.json({ error: COMPANY_ONLY_API_ERROR }, { status: 403 });
  }
  // Замены на эту точку завершаем с возвратом: иначе каскад удалил бы
  // назначения, и снятые переводом точки людям уже не вернулись бы.
  await endAssignmentsAtBuilding(orgId, id, auth.session);
  const removed = await db.building.delete({ where: { id }, select: { kind: true } });
  // Без офиса руководителей точек больше нет (фаза 2 «Офис и точки»).
  if (isOfficeBuilding(removed)) await closePointManagerSessions(orgId, auth.session.user.id);
  return NextResponse.json({ ok: true });
}

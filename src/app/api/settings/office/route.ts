import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { recordAuditLog } from "@/lib/audit-log";
import { OFFICE_BUILDING_KIND } from "@/lib/building-scope";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { closePointManagerSessions } from "@/lib/point-scope.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — выделить офис организации (2026-10-26): служебная «точка»
 * `kind = "office"`, одна на организацию. Её сотрудники видят все точки,
 * а журналы и задачи у них только офисные. Офис есть — возвращаем его.
 * Нужна хотя бы одна торговая точка: офис + точка — два места, поэтому
 * выделение офиса само включает журналы по точкам (2026-11-12: с одной
 * точкой тумблер деления недоступен, и офис было не завести).
 * Дизайн: docs/superpowers/specs/2026-10-26-office-and-points-design.md
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Офис выделяет руководитель компании" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { perLocationJournals: true, address: true, phone: true },
  });
  if (!org) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  const [existing, pointCount] = await Promise.all([
    db.building.findFirst({
      where: { organizationId, kind: OFFICE_BUILDING_KIND },
      select: { id: true, name: true },
    }),
    db.building.count({ where: { organizationId, NOT: { kind: OFFICE_BUILDING_KIND } } }),
  ]);
  if (pointCount < 1) {
    return NextResponse.json({ error: "Сначала добавьте торговую точку" }, { status: 400 });
  }

  let building = existing;
  if (!building) {
    const [names, first] = await Promise.all([
      db.building.findMany({ where: { organizationId }, select: { name: true } }),
      db.building.findFirst({ where: { organizationId }, orderBy: { sortOrder: "asc" }, select: { sortOrder: true } }),
    ]);
    const taken = new Set(names.map((item) => item.name));
    const name = ["Офис", "Офис компании", "Офис организации"].find((candidate) => !taken.has(candidate)) ?? `Офис ${Date.now()}`;
    building = await db.building.create({
      data: {
        organizationId,
        kind: OFFICE_BUILDING_KIND,
        name,
        address: org.address,
        phone: org.phone,
        // Первым в переключателе шапки.
        sortOrder: (first?.sortOrder ?? 0) - 1,
      },
      select: { id: true, name: true },
    });
    // Кто выделил офис — человек офиса: иначе, закреплённый за точкой, он
    // стал бы руководителем точки и потерял «Моя компания → Офис».
    const creator = await db.user.findFirst({
      where: { id: session.user.id, organizationId },
      select: { buildingIds: true },
    });
    if (creator && creator.buildingIds.length > 0) {
      await db.user.update({ where: { id: session.user.id }, data: { buildingIds: [building.id] } });
    }
  }
  // Офис + точка — журналы ведутся по местам, в шапке переключатель.
  if (!org.perLocationJournals) {
    await db.organization.update({ where: { id: organizationId }, data: { perLocationJournals: true } });
  }
  if (existing && org.perLocationJournals) return NextResponse.json({ building: existing, created: false });

  // Руководители, закреплённые за точками, стали руководителями точек —
  // их сессии перевыпускаются при следующем входе (фаза 2).
  await closePointManagerSessions(organizationId, session.user.id);
  await recordAuditLog({
    request,
    session,
    organizationId,
    action: existing ? "building.office_split_enabled" : "building.office_created",
    entity: "building",
    entityId: building.id,
    details: { name: building.name, perLocationJournalsEnabled: !org.perLocationJournals },
  });
  return NextResponse.json({ building, created: !existing });
}

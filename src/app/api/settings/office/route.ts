import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { recordAuditLog } from "@/lib/audit-log";
import { OFFICE_BUILDING_KIND } from "@/lib/building-scope";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — выделить офис организации (2026-10-26): служебная «точка»
 * `kind = "office"`, одна на организацию. Её сотрудники видят все точки,
 * а журналы и задачи у них только офисные. Офис есть — возвращаем его.
 * Только при журналах по точкам: без точек офису нечего отделять.
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
  if (!org.perLocationJournals) {
    return NextResponse.json({ error: "Офис выделяется, когда журналы ведутся по точкам" }, { status: 400 });
  }

  const existing = await db.building.findFirst({
    where: { organizationId, kind: OFFICE_BUILDING_KIND },
    select: { id: true, name: true },
  });
  if (existing) return NextResponse.json({ building: existing, created: false });

  const [names, first] = await Promise.all([
    db.building.findMany({ where: { organizationId }, select: { name: true } }),
    db.building.findFirst({ where: { organizationId }, orderBy: { sortOrder: "asc" }, select: { sortOrder: true } }),
  ]);
  const taken = new Set(names.map((building) => building.name));
  const name = ["Офис", "Офис компании", "Офис организации"].find((candidate) => !taken.has(candidate)) ?? `Офис ${Date.now()}`;
  const building = await db.building.create({
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
  await recordAuditLog({
    request,
    session,
    organizationId,
    action: "building.office_created",
    entity: "building",
    entityId: building.id,
    details: { name },
  });
  return NextResponse.json({ building, created: true });
}

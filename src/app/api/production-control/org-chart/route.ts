import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { orgChartFromPositions, type OrgChartPosition } from "@/lib/ppk/org-chart";
import { PPK_RECORD_LIMITS, PPK_RECORD_SCHEMAS } from "@/lib/ppk/records";
import { ppkWhere } from "@/lib/ppk/scope";
import { ppkStaffWhere } from "@/lib/ppk/staff.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — «Собрать из должностей» (пункт 1.2): черновик оргструктуры из
 * должностей сотрудников объекта (нет сотрудников с должностями — все
 * должности организации), руководитель — из реквизитов. Отдаёт id схемы.
 */
export async function POST(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  const count = await db.ppkRecord.count({ where: { ...ppkWhere(scope), block: "org-chart" } });
  if (count >= PPK_RECORD_LIMITS["org-chart"]) {
    return NextResponse.json({ error: "Слишком много схем" }, { status: 409 });
  }

  const [org, users, allPositions] = await Promise.all([
    db.organization.findUnique({ where: { id: scope.organizationId }, select: { directorPost: true } }),
    db.user.findMany({
      where: { AND: [{ organizationId: scope.organizationId, ...ORG_ROSTER_WHERE }, await ppkStaffWhere(scope)] },
      select: { jobPosition: { select: { name: true, categoryKey: true, sortOrder: true } } },
    }),
    db.jobPosition.findMany({
      where: { organizationId: scope.organizationId },
      select: { name: true, categoryKey: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);
  const staffed = users
    .map((user) => user.jobPosition)
    .filter((position): position is NonNullable<typeof position> => position !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"));
  const source = staffed.length > 0 ? staffed : allPositions;
  const positions: OrgChartPosition[] = source.map((position) => ({
    name: position.name,
    category: position.categoryKey === "management" ? "management" : "staff",
  }));

  const data = orgChartFromPositions({
    title: "Организационная структура",
    head: org?.directorPost || "Руководитель",
    positions,
  });
  const parsed = PPK_RECORD_SCHEMAS["org-chart"].safeParse(data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Не удалось собрать схему" }, { status: 400 });
  }

  const last = await db.ppkRecord.aggregate({
    where: { ...ppkWhere(scope), block: "org-chart" },
    _max: { sortOrder: true },
  });
  const record = await db.ppkRecord.create({
    data: {
      organizationId: scope.organizationId,
      buildingId: scope.buildingId,
      block: "org-chart",
      data: parsed.data as Prisma.InputJsonValue,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
      createdById: auth.session.user.id ?? null,
    },
    select: { id: true },
  });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: scope.organizationId,
    action: "production-control.record-create",
    entity: "PpkRecord",
    entityId: record.id,
    details: { block: "org-chart", from: "positions", positions: positions.length },
  });
  return NextResponse.json({ record }, { status: 201 });
}

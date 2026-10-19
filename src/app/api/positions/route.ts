import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";
import { computeStaffing, plannedHeadcountSchema } from "@/lib/staffing";

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Название должности слишком короткое")
    .max(120, "Слишком длинное название"),
  categoryKey: z.enum(["management", "staff", "commission"], {
    message: "Недопустимая категория",
  }),
  plannedHeadcount: plannedHeadcountSchema.optional(),
});

function forbidden() {
  return NextResponse.json(
    { error: "Это действие доступно руководителю" },
    { status: 403 }
  );
}

/**
 * GET /api/positions — должности организации со штатной численностью:
 * у каждой `plannedHeadcount`, `occupied`, `vacancies`, `overstaffed`,
 * `staffingLabel` («занято N из M»); итоги — `totals`.
 */
export async function GET() {
  const session = await requireAuth();
  const orgId = getActiveOrgId(session);
  const [positions, members] = await Promise.all([
    db.jobPosition.findMany({
      where: { organizationId: orgId },
      orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        categoryKey: true,
        sortOrder: true,
        plannedHeadcount: true,
        _count: { select: { users: { where: { archivedAt: null } } } },
      },
    }),
    db.user.findMany({
      where: { organizationId: orgId, archivedAt: null, isActive: true, jobPositionId: { not: null } },
      select: { jobPositionId: true, isActive: true, archivedAt: true },
    }),
  ]);
  const staffing = computeStaffing(positions, members);
  return NextResponse.json({ positions: staffing.positions, totals: staffing.totals });
}

export async function POST(request: Request) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return forbidden();
  }
  const orgId = getActiveOrgId(session);

  let parsed;
  try {
    parsed = createSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Не удалось прочитать запрос" }, { status: 400 });
  }

  const existing = await db.jobPosition.findUnique({
    where: {
      organizationId_categoryKey_name: {
        organizationId: orgId,
        categoryKey: parsed.categoryKey,
        name: parsed.name,
      },
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Такая должность уже существует" },
      { status: 409 }
    );
  }

  const last = await db.jobPosition.findFirst({
    where: { organizationId: orgId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const position = await db.jobPosition.create({
    data: {
      organizationId: orgId,
      categoryKey: parsed.categoryKey,
      name: parsed.name,
      sortOrder: (last?.sortOrder ?? 0) + 1,
      ...(parsed.plannedHeadcount !== undefined ? { plannedHeadcount: parsed.plannedHeadcount } : {}),
    },
  });

  return NextResponse.json({ position });
}

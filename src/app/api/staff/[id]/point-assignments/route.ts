import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getServerSession } from "@/lib/server-session";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ASSIGNMENT_MAX_DAYS, ASSIGNMENT_MIN_DAYS, PLAN_ASSIGNMENT_ERRORS } from "@/lib/point-assignments";
import { createPointAssignment } from "@/lib/point-assignments.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  buildingId: z.string().min(1, "Выберите точку"),
  mode: z.enum(["transfer", "extra"], { message: PLAN_ASSIGNMENT_ERRORS.bad_mode }),
  days: z
    .number({ message: PLAN_ASSIGNMENT_ERRORS.bad_days })
    .int(PLAN_ASSIGNMENT_ERRORS.bad_days)
    .min(ASSIGNMENT_MIN_DAYS, PLAN_ASSIGNMENT_ERRORS.bad_days)
    .max(ASSIGNMENT_MAX_DAYS, PLAN_ASSIGNMENT_ERRORS.bad_days),
});

/**
 * POST /api/staff/[id]/point-assignments { buildingId, mode, days }
 *
 * Временно на другую точку (замена): «transfer» — на срок только там,
 * «extra» — и там, и на своих. По сроку точки вернутся сами
 * (`expirePointAssignments`). Права — как у правки сотрудника
 * (PUT /api/users/[id]); руководитель точки берёт людей только на свои точки.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!hasFullWorkspaceAccess({ role: session.user.role, isRoot: session.user.isRoot === true })) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const { id } = await params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
    }
    return NextResponse.json({ error: "Не удалось прочитать запрос" }, { status: 400 });
  }

  const result = await createPointAssignment({
    session,
    organizationId: getActiveOrgId(session),
    userId: id,
    buildingId: body.buildingId,
    mode: body.mode,
    days: body.days,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code ?? null }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    assignmentId: result.assignmentId,
    endsAt: result.endsAt.toISOString(),
    returnKey: result.returnKey,
  });
}

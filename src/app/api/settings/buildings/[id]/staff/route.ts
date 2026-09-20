import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  userIds: z.array(z.string().min(1)).max(500),
});

/**
 * PUT /api/settings/buildings/[id]/staff { userIds }
 *
 * Точки (2026-09-05): «кто работает на этой точке» со стороны точки —
 * зеркало чипов «Точки» в карточке сотрудника. Отмеченным сотрудникам
 * точка добавляется в `User.buildingIds`, у снятых — убирается. Пустой
 * список у сотрудника по-прежнему значит «все точки», поэтому снятие
 * единственной точки возвращает человека на все точки — об этом
 * предупреждает интерфейс.
 */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  const { id: buildingId } = await ctx.params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Bad input" }, { status: 400 });
    }
    throw err;
  }

  const building = await db.building.findFirst({
    where: { id: buildingId, organizationId: orgId },
    select: { id: true },
  });
  if (!building) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const users = await db.user.findMany({
    where: { organizationId: orgId, isActive: true, archivedAt: null, isRoot: false },
    select: { id: true, buildingIds: true },
  });
  const wanted = new Set(body.userIds);
  let changed = 0;
  for (const user of users) {
    const has = user.buildingIds.includes(building.id);
    const want = wanted.has(user.id);
    if (has === want) continue;
    const next = want
      ? [...user.buildingIds, building.id]
      : user.buildingIds.filter((id) => id !== building.id);
    await db.user.update({ where: { id: user.id }, data: { buildingIds: next } });
    changed += 1;
  }

  return NextResponse.json({ ok: true, changed });
}

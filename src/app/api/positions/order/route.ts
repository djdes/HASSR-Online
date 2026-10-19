import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { planPositionOrder } from "@/lib/staffing";
import { isManagementRole } from "@/lib/user-roles";

const orderSchema = z.object({
  ids: z
    .array(z.string().trim().min(1).max(64), { message: "Передайте список должностей" })
    .min(1, "Передайте список должностей")
    .max(500, "Слишком много должностей")
    .refine((ids) => new Set(ids).size === ids.length, "Должности в списке повторяются"),
});

/**
 * PUT /api/positions/order { ids: string[] } — порядок должностей.
 * Присланные получают `sortOrder` 1…N в присланном порядке, остальные
 * должности организации идут следом в прежнем порядке. Только
 * руководитель; должность чужой организации или несуществующая — 404.
 */
export async function PUT(request: Request) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(session);

  const parsed = orderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные данные" },
      { status: 400 }
    );
  }

  const current = await db.jobPosition.findMany({
    where: { organizationId: orgId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, sortOrder: true },
  });
  const own = new Set(current.map((position) => position.id));
  const unknown = parsed.data.ids.filter((id) => !own.has(id));
  if (unknown.length > 0) {
    return NextResponse.json({ error: "Должность не найдена", ids: unknown }, { status: 404 });
  }

  const order = planPositionOrder(current, parsed.data.ids);
  const changed = current.filter((position) => order.get(position.id) !== position.sortOrder);
  await db.$transaction(
    changed.map((position) =>
      db.jobPosition.update({
        where: { id: position.id },
        data: { sortOrder: order.get(position.id) },
      })
    )
  );

  return NextResponse.json({
    ok: true,
    order: [...order.entries()].map(([id, sortOrder]) => ({ id, sortOrder })),
  });
}

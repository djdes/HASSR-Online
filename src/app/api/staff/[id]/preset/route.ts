import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability, isValidPreset } from "@/lib/permission-presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/staff/[id]/preset
 *   body: { preset: "admin" | "head_chef" | "cook" | "waiter" | "seller" | "cashier" | "cleaner" | null }
 *
 * Обновляет permissionPreset у сотрудника. Только admin может менять.
 */
const bodySchema = z.object({
  preset: z.string().nullable(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Невалидный запрос" }, { status: 400 });
  }
  if (body.preset && !isValidPreset(body.preset)) {
    return NextResponse.json({ error: "Невалидный preset" }, { status: 400 });
  }

  const organizationId = getActiveOrgId(session);
  const user = await db.user.findUnique({
    where: { id },
    select: { organizationId: true },
  });
  if (!user || user.organizationId !== organizationId) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  await db.user.update({
    where: { id },
    data: { permissionPreset: body.preset },
  });
  return NextResponse.json({ ok: true });
}

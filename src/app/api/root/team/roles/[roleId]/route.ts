import { NextResponse } from "next/server";
import { requireSuperRoot } from "@/lib/auth-helpers";
import { roleInputSchema } from "@/lib/platform-roles";
import { deletePlatformRole, updatePlatformRole } from "@/lib/platform-roles.server";
import { TeamError } from "@/lib/platform-team.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT — изменить роль (её люди сразу получают новые разделы и РОП); DELETE — удалить пустую не встроенную. */
export async function PUT(request: Request, { params }: { params: Promise<{ roleId: string }> }) {
  const session = await requireSuperRoot();
  const { roleId } = await params;
  const parsed = roleInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Неверный запрос" }, { status: 400 });
  try {
    return NextResponse.json({ role: await updatePlatformRole(session, roleId, parsed.data) });
  } catch (error) {
    if (error instanceof TeamError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ roleId: string }> }) {
  const session = await requireSuperRoot();
  const { roleId } = await params;
  try {
    await deletePlatformRole(session, roleId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TeamError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

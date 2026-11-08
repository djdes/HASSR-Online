import { NextResponse } from "next/server";
import { requireSuperRoot } from "@/lib/auth-helpers";
import { roleInputSchema } from "@/lib/platform-roles";
import { createPlatformRole, listPlatformRoles } from "@/lib/platform-roles.server";
import { TeamError } from "@/lib/platform-team.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Роли панели (только владелец): GET — список, POST — новая роль. */
export async function GET() {
  await requireSuperRoot();
  return NextResponse.json({ roles: await listPlatformRoles() });
}

export async function POST(request: Request) {
  const session = await requireSuperRoot();
  const parsed = roleInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Неверный запрос" }, { status: 400 });
  try {
    return NextResponse.json({ role: await createPlatformRole(session, parsed.data) });
  } catch (error) {
    if (error instanceof TeamError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperRoot } from "@/lib/auth-helpers";
import { TeamError, setPlatformSections } from "@/lib/platform-team.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ sections: z.array(z.string().max(40)).max(30) });

/** PUT { sections } — open panel sections to a person; [] closes access. */
export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await requireSuperRoot();
  const { userId } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  try {
    const member = await setPlatformSections(session, userId, parsed.data.sections);
    return NextResponse.json({ member });
  } catch (error) {
    if (error instanceof TeamError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

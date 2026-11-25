import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { cancelWeekly, loadWeeklyView } from "@/lib/weekly-issue/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["cancel"]) });

/** POST /api/root/max-channel/weekly/<id> { action: "cancel" } — выпуск этой недели не выйдет. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  try {
    await cancelWeekly(id);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || "Не получилось" }, { status: 409 });
  }
  return NextResponse.json(await loadWeeklyView());
}

import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { weeklyEmailPreview } from "@/lib/weekly-issue/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — письмо выпуска, как его увидит получатель (пример имени и компании). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await ctx.params;
  try {
    const preview = await weeklyEmailPreview(id);
    if (!preview) return NextResponse.json({ error: "Выпуск ещё не собран" }, { status: 404 });
    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || "Не получилось" }, { status: 409 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getTranslationActor, listTranslationHistory } from "@/lib/translations/editor.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?key= — история правок строки по всем языкам (AuditLog), новые сверху. */

const Query = z.object({ key: z.string().min(1).max(300) });

export async function GET(request: Request) {
  const actor = await getTranslationActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  return NextResponse.json({ items: await listTranslationHistory(parsed.data.key) });
}

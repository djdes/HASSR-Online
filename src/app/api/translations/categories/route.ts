import { NextResponse } from "next/server";
import { getTranslationActor, listCategoryStats } from "@/lib/translations/editor.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — категории редактора переводов со счётчиками строк, правок и пропусков. */
export async function GET() {
  const actor = await getTranslationActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ categories: await listCategoryStats() });
}

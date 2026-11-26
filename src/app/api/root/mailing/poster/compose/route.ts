import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { readJson } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { background, screen, kicker, word, cardTitle, cardValue, cta } —
 * собрать постер с надписями поверх готового фона (без новой генерации).
 * Ответ `{ image, imageKey }`; одинаковые надписи дают тот же файл.
 */
export async function POST(request: Request) {
  await requireRoot();
  const { PosterError, composePoster } = await import("@/lib/mailing/poster-image.server");
  try {
    const result = await composePoster(await readJson(request));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PosterError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[mailing] poster compose failed", error);
    return NextResponse.json({ error: "Не получилось собрать постер — подробности в логе" }, { status: 500 });
  }
}

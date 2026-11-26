import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { readJson } from "@/lib/mailing/http.server";
import { POSTER_SCENES, type PosterScene } from "@/lib/mailing/kinds/poster-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Модуль с canvas грузим лениво: он нужен только этому маршруту.
const posterImage = () => import("@/lib/mailing/poster-image.server");

async function errorResponse(error: unknown, scope: string): Promise<NextResponse> {
  const { PosterError } = await posterImage();
  if (error instanceof PosterError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`[mailing] poster ${scope} failed`, error);
  return NextResponse.json({ error: "Не получилось — ошибка на сервере, подробности в логе" }, { status: 500 });
}

/** POST { scene } — поставить генерацию фона постера; ответ `{ job }`, фон готов через 1–3 минуты. */
export async function POST(request: Request) {
  await requireRoot();
  try {
    const body = await readJson(request);
    const scene: PosterScene = POSTER_SCENES.find((s) => s.key === body.scene)?.key ?? "restaurant";
    const { startPosterBackground } = await posterImage();
    const job = await startPosterBackground(scene);
    console.info(`[mailing] poster background job=${job} scene=${scene}`);
    return NextResponse.json({ job });
  } catch (error) {
    return errorResponse(error, "background");
  }
}

/** GET ?job=<id> — `{ status: "pending" }` или `{ status: "ready", background }`. */
export async function GET(request: Request) {
  await requireRoot();
  try {
    const job = new URL(request.url).searchParams.get("job") ?? "";
    const { posterBackgroundStatus } = await posterImage();
    return NextResponse.json(await posterBackgroundStatus(job));
  } catch (error) {
    return errorResponse(error, "background status");
  }
}

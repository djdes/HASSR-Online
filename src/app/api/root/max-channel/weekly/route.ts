import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { buildWeeklyNow, loadWeeklyView, runWeeklyTick, saveWeeklySettings } from "@/lib/weekly-issue/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/root/max-channel/weekly — выключатель, выпуск ближайшей среды и прошлые. */
export async function GET() {
  await requireRoot();
  return NextResponse.json(await loadWeeklyView());
}

const patchSchema = z.object({ enabled: z.boolean() });

/** PATCH { enabled } — «Еженедельный выпуск» вкл/выкл (сборка по понедельникам). */
export async function PATCH(request: Request) {
  await requireRoot();
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  await saveWeeklySettings(parsed.data);
  return NextResponse.json(await loadWeeklyView());
}

/**
 * POST — «Собрать выпуск на среду»: ближайшая среда; невышедший выпуск
 * пересобирается заново. Первый шаг (факты и задача текста) — сразу.
 */
export async function POST() {
  await requireRoot();
  try {
    const result = await buildWeeklyNow();
    await runWeeklyTick().catch(() => undefined);
    return NextResponse.json({ ...result, ...(await loadWeeklyView()) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || "Не получилось" }, { status: 409 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoot } from "@/lib/auth-helpers";
import {
  GglAuthError,
  GglCallError,
  GglIsolationError,
} from "@/lib/seo/gogetlinks-client.server";
import { GglSyncError, syncGglCabinet } from "@/lib/seo/gogetlinks-sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const syncBodySchema = z.object({
  includeThreads: z.boolean().optional(),
});

export async function POST(request: Request) {
  await requireRoot();

  const rawBody = await request.json().catch(() => ({}));
  const parsed = syncBodySchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные параметры синхронизации" },
      { status: 400 },
    );
  }

  try {
    const summary = await syncGglCabinet({
      includeThreads: parsed.data.includeThreads,
    });
    return NextResponse.json({ ok: true, ...summary, summary });
  } catch (err) {
    if (err instanceof GglSyncError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof GglIsolationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof GglAuthError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof GglCallError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[ggl-sync] unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка синхронизации с GoGetLinks" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueAndWait } from "@/lib/ai-assistant/pf-client";
import { createRateLimiter } from "@/lib/rate-limit";
import { AUTO_TRANSLATE_BATCH, buildAutoTranslateJob, parseAutoTranslateReply } from "@/lib/translations/auto-translate";
import { getEntries, getTranslationActor } from "@/lib/translations/editor.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

/**
 * POST { locale: "en" | "uz", keys } — черновик перевода с русского через
 * очередь AI-диспетчера (сайт к модели не ходит). Ничего не сохраняет:
 * переводчик смотрит черновик и сохраняет сам.
 */

const Body = z.object({
  locale: z.enum(["en", "uz"]),
  keys: z.array(z.string().min(1).max(300)).min(1).max(AUTO_TRANSLATE_BATCH),
});

const autoTranslateLimiter = createRateLimiter({ tokensPerInterval: 6, intervalMs: 60_000 });

export async function POST(request: Request) {
  const actor = await getTranslationActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!autoTranslateLimiter.consume(`translations-auto:${actor.id}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const entries = await getEntries([...new Set(parsed.data.keys)]);
  if (!entries.length) return NextResponse.json({ error: "unknown_key" }, { status: 404 });
  // Источник — русский, как его видит интерфейс (с правками).
  const source = Object.fromEntries(entries.map((entry) => [entry.key, entry.values.ru]));
  const result = await enqueueAndWait(buildAutoTranslateJob(parsed.data.locale, source), { deadlineMs: 120_000 });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.code === "not_configured" ? "ai_not_configured" : "ai_failed", detail: result.error },
      { status: result.code === "not_configured" ? 503 : 502 },
    );
  }
  return NextResponse.json(parseAutoTranslateReply(result.text, source));
}

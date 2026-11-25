import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { CodexGatewayError, codexGatewayConfigured, readTextJob, startTextJob } from "@/lib/codex-gateway";
import { buildReviewInstructions, parseReview } from "@/lib/smm/quality";
import { BRAND } from "@/lib/smm/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startSchema = z.object({
  text: z.string().trim().min(10, "Нечего проверять — напишите текст").max(4000),
  /** Замечания детерминированной проверки — модель исправит их в первую очередь. */
  issues: z.array(z.string().max(300)).max(30).default([]),
  /** rewrite — переписать по замечаниям (A22); review — только оценить тон и оффер (B10, B24). */
  mode: z.enum(["review", "rewrite"]).default("review"),
});

/**
 * ИИ-рецензия поста через Codex-шлюз ProjectsFlow (B10, B24, B30-ИИ, A22).
 * POST — ставит задачу, GET ?job=<id> — забирает результат.
 */
export async function POST(request: Request) {
  await requireRoot();
  if (!codexGatewayConfigured()) return NextResponse.json({ error: "Шлюз ИИ не настроен на сервере." }, { status: 503 });
  const parsed = startSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте текст" }, { status: 400 });
  const { text, issues, mode } = parsed.data;
  const input = [
    `Режим: ${mode === "rewrite" ? "перепиши пост, исправив замечания" : "оцени пост; в поле text верни улучшенную версию"}.`,
    issues.length ? `Замечания автоматической проверки:\n- ${issues.join("\n- ")}` : "",
    `Пост:\n${text}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    const job = await startTextJob(input, buildReviewInstructions(BRAND));
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof CodexGatewayError ? error.message : "Шлюз ИИ недоступен";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET(request: Request) {
  await requireRoot();
  const job = new URL(request.url).searchParams.get("job") ?? "";
  if (!/^[\w-]{4,80}$/.test(job)) return NextResponse.json({ error: "Нет задачи" }, { status: 400 });
  try {
    const result = await readTextJob(job);
    if (result.status === "queued" || result.status === "running") return NextResponse.json({ status: result.status });
    if (result.status !== "succeeded" || !result.text) {
      return NextResponse.json({ status: "failed", error: result.error ?? "ИИ не ответил" });
    }
    const review = parseReview(result.text);
    if (!review) return NextResponse.json({ status: "failed", error: "ИИ ответил не по формату — попробуйте ещё раз" });
    return NextResponse.json({ status: "done", review });
  } catch (error) {
    const message = error instanceof CodexGatewayError ? error.message : "Шлюз ИИ недоступен";
    return NextResponse.json({ status: "failed", error: message });
  }
}

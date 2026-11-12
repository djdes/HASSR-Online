import { NextResponse } from "next/server";
import { z } from "zod";

import { clientIp } from "@/lib/client-ip";
import { codexGatewayConfigured, readTextJob, startTextJob } from "@/lib/codex-gateway";
import { KB_ASK_INSTRUCTIONS } from "@/lib/kb/ask-instructions";
import { kbAskGlobalRateLimiter, kbAskRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Шлюз отвечает 10–60 секунд: ждём ответ в этом же запросе.
export const maxDuration = 120;

const bodySchema = z.object({
  question: z.string().trim().min(3).max(600),
  /** Предыдущие реплики — чтобы можно было уточнить вопрос. */
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
    .max(6)
    .optional(),
});

const NO_STORE = { "Cache-Control": "no-store" };
const WAIT_MS = 100_000;

/**
 * POST /api/kb/ask — «Спросить у ИИ» в публичной базе знаний.
 * Без входа: лимит по IP и общий потолок. Вопрос уходит в Codex-шлюз
 * ProjectsFlow с текстом базы знаний в инструкциях; ответ ждём тут же.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Сформулируйте вопрос — от 3 до 600 символов." }, { status: 400, headers: NO_STORE });
  if (!codexGatewayConfigured()) return NextResponse.json({ error: "Ассистент сейчас недоступен. Напишите в поддержку: @wesetup_support." }, { status: 503, headers: NO_STORE });

  const key = `ip:${clientIp(request) ?? "unknown"}`;
  if (!kbAskRateLimiter.consume(key) || !kbAskGlobalRateLimiter.consume("all")) {
    return NextResponse.json({ error: "Слишком много вопросов подряд — попробуйте через несколько минут." }, { status: 429, headers: NO_STORE });
  }

  const { question, history = [] } = parsed.data;
  const input = [
    ...history.map((turn) => `${turn.role === "user" ? "Вопрос" : "Ответ"}: ${turn.content}`),
    `Вопрос: ${question}`,
  ].join("\n\n");

  try {
    const id = await startTextJob(input, KB_ASK_INSTRUCTIONS);
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const job = await readTextJob(id);
      if (job.status === "succeeded" && job.text) return NextResponse.json({ answer: job.text.trim() }, { headers: NO_STORE });
      if (job.status === "failed" || job.status === "cancelled") break;
      // Шлюз сам держит запрос до 5 с; пауза — на случай, если ответил сразу.
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return NextResponse.json({ error: "Ассистент не успел ответить. Попробуйте ещё раз или напишите в поддержку." }, { status: 504, headers: NO_STORE });
  } catch (error) {
    console.error("[kb/ask]", error instanceof Error ? error.message : error);
    kbAskRateLimiter.refund(key);
    return NextResponse.json({ error: "Ассистент сейчас недоступен. Напишите в поддержку: @wesetup_support." }, { status: 502, headers: NO_STORE });
  }
}

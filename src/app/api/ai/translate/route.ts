import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth-helpers";
import { enqueueAndWait } from "@/lib/ai-assistant/pf-client";
import { aiHeavyRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * L7 — AI-перевод инструкций для иностранных рабочих.
 *
 * POST /api/ai/translate
 * Body: { text: string, to: "tg" | "uz" | "ky" | "tk" | "en" }
 *
 * В РФ много мигрантов — повара, посудомойки, уборщики из СА. Помощь
 * руководителю быстро перевести «инструкцию по гигиене» / «как
 * заполнять журнал» на их язык.
 *
 * Auth: management только. Расходует общую AI-квоту.
 */

const Schema = z.object({
  text: z.string().min(1).max(4000),
  to: z.enum(["tg", "uz", "ky", "tk", "en", "ar"]),
});

const LANG_NAMES: Record<string, string> = {
  tg: "таджикский",
  uz: "узбекский",
  ky: "киргизский",
  tk: "туркменский",
  en: "английский",
  ar: "арабский",
};

const SYSTEM_PROMPT = `Ты — переводчик-консультант для пищевой индустрии. Переводишь инструкции и подсказки для рабочих ресторанов и кухонь с русского на указанный язык.

Стиль:
- Простые слова. Рабочий не имеет высшего образования и читает на этом языке на бытовом уровне.
- Сохраняй термины СанПиН/ХАССП в скобках с оригиналом если они нелегко переводимы.
- Числа и температуры оставляй как есть.
- Без приветствий и вступлений — сразу перевод.

Возвращай ТОЛЬКО переведённый текст. Никаких пояснений.`;

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!aiHeavyRateLimiter.consume(`ai-translate:${auth.session.user.id}`)) {
    return NextResponse.json(
      { error: "Слишком много запросов на перевод" },
      { status: 429 }
    );
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad input" },
        { status: 400 }
      );
    }
    throw err;
  }

  // AI-запрос уходит в очередь диспетчера ProjectsFlow — сайт к LLM не
  // ходит (см. src/lib/ai-assistant/pf-client.ts).
  const result = await enqueueAndWait(
    [
      "type: wesetup_translate",
      "---",
      SYSTEM_PROMPT,
      "---",
      `Переведи на ${LANG_NAMES[body.to]}:\n\n${body.text}`,
    ].join("\n")
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.code === "not_configured" ? 503 : 502 }
    );
  }
  return NextResponse.json({
    translated: result.text.trim(),
    languageCode: body.to,
    languageName: LANG_NAMES[body.to],
  });
}

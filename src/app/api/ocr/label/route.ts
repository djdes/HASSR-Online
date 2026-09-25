import { NextResponse } from "next/server";

import { buildVisionInstruction } from "@/lib/ai-vision/instructions";
import { parseLabelReply } from "@/lib/ai-vision/parse";
import { runVisionJob } from "@/lib/ai-vision/run";
import { sniffImageMime } from "@/lib/ai-vision/temp-store";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/ocr/label — распознать этикетку продукта (PhotoCapture в
 * DynamicForm). Контракт прежний: multipart `photo` → `{ result }` с полями
 * OcrResult, ошибка — `{ error }`.
 *
 * Раньше маршрут ходил в Anthropic API с ключом сайта — на проде ключа нет.
 * Теперь тем же путём, что «Распознать с фото»: задание
 * `wesetup_vision_extract` диспетчеру со ссылкой на фото (подпись + 15 мин),
 * см. `src/lib/ai-vision/run.ts`. Лимиты — общие с «С фото».
 */

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const MESSAGES = {
  not_configured: "Распознавание этикеток пока не подключено — заполните поля вручную.",
  timeout: "Не успели распознать этикетку — попробуйте ещё раз или заполните поля вручную.",
  failed: "Не получилось распознать этикетку — попробуйте ещё раз или заполните поля вручную.",
};

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let file: File | null = null;
  try {
    const value = (await request.formData()).get("photo");
    file = value && typeof value === "object" ? (value as File) : null;
  } catch {
    file = null;
  }
  if (!file) {
    return NextResponse.json({ error: "Фото не загружено" }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: `Файл слишком большой (максимум ${MAX_PHOTO_BYTES / 1024 / 1024} MB)` },
      { status: 413 }
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffImageMime(bytes)) {
    return NextResponse.json({ error: "Поддерживаются только JPEG, PNG или WEBP" }, { status: 415 });
  }

  const outcome = await runVisionJob({
    purpose: "label",
    instruction: buildVisionInstruction("label"),
    images: [bytes],
    orgId: getActiveOrgId(session),
    user: { id: session.user.id, name: session.user.name },
    messages: MESSAGES,
    parse: (text) => {
      const result = parseLabelReply(text);
      if (!result) console.warn(`[ai-vision] label reply without JSON: ${text.slice(0, 160)}`);
      return { value: result, rows: result?.productName ? 1 : 0 };
    },
  });
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  if (!outcome.value) {
    return NextResponse.json({ error: "Не удалось разобрать этикетку. Попробуйте другое фото." }, { status: 422 });
  }
  return NextResponse.json({ result: outcome.value });
}

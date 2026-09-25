import { NextResponse } from "next/server";

import { buildVisionInstruction } from "@/lib/ai-vision/instructions";
import { parseReadingReply } from "@/lib/ai-vision/parse";
import { runVisionJob } from "@/lib/ai-vision/run";
import { sniffImageMime } from "@/lib/ai-vision/temp-store";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const MESSAGES = {
  not_configured: "Распознавание показаний пока не подключено — введите значение вручную.",
  timeout: "Не успели распознать показание — попробуйте ещё раз или введите значение вручную.",
  failed: "Не получилось распознать показание — попробуйте ещё раз или введите значение вручную.",
};

/**
 * POST /api/ocr/reading — распознать ОДНО число с дисплея прибора
 * (кнопка «Снять показание с дисплея», `DisplayOcrButton`).
 *
 * Отличается от `/api/ocr/label` (та читает этикетку продукта и
 * возвращает десяток полей): здесь нужен ровно один показатель —
 * температура с термометра, влажность с гигрометра, наработка со
 * счётчика УФ-установки. Распознанное значение подставляется в поле, но
 * сохраняет его человек — подтверждение остаётся за ним.
 *
 * Контракт прежний: multipart `photo` → `{ value, unit, confidence }`,
 * ошибка — `{ error }`. Раньше маршрут ходил в Anthropic API с ключом сайта
 * (на проде ключа нет); теперь — задание `wesetup_vision_extract`
 * диспетчеру со ссылкой на фото (подпись + 15 минут), инструкция вида
 * `reading`, лимиты общие с «С фото». См. `src/lib/ai-vision/run.ts`.
 */
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
    return NextResponse.json({ error: "Файл слишком большой" }, { status: 413 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffImageMime(bytes)) {
    return NextResponse.json({ error: "Поддерживаются только JPEG, PNG или WEBP" }, { status: 415 });
  }

  const outcome = await runVisionJob({
    purpose: "reading",
    instruction: buildVisionInstruction("reading"),
    images: [bytes],
    orgId: getActiveOrgId(session),
    user: { id: session.user.id, name: session.user.name },
    messages: MESSAGES,
    parse: (text) => {
      const result = parseReadingReply(text);
      if (!result) console.warn(`[ai-vision] reading reply without JSON: ${text.slice(0, 160)}`);
      return { value: result, rows: result && result.value !== null ? 1 : 0 };
    },
  });
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  if (!outcome.value) {
    return NextResponse.json({ error: "Не удалось разобрать ответ. Попробуйте другое фото." }, { status: 422 });
  }
  return NextResponse.json(outcome.value);
}

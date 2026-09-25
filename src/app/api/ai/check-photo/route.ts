import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { z } from "zod";

import { buildVisionInstruction } from "@/lib/ai-vision/instructions";
import { parsePhotoCheckReply } from "@/lib/ai-vision/parse";
import { runVisionJob } from "@/lib/ai-vision/run";
import { sniffImageMime } from "@/lib/ai-vision/temp-store";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { resolveUploadPath } from "@/lib/uploads-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * L4 — AI-проверка качества photo evidence в журналах.
 *
 * POST /api/ai/check-photo
 * Body: { imageUrl: string, expectedKind: "food" | "equipment" | "document" | "any" }
 * Ответ: { valid, confidence (0…1), kind, reason } — содержит ли фото
 * ожидаемый объект, либо это случайный палец / размытое / тёмное.
 *
 * Используется опционально на upload — менеджер получает hint
 * «фото №3 не похоже на еду, перезалить?».
 *
 * Сайт к модели не ходит: фото уходит диспетчеру заданием
 * `wesetup_vision_extract` (ссылка с подписью и сроком 15 минут, инструкция
 * вида `photo_check`), лимиты общие с «С фото». См. `src/lib/ai-vision/run.ts`.
 *
 * SECURITY: imageUrl ограничен путями `/uploads/<safe-name>` — файл
 * читается с диска из каталога загрузок (`resolveUploadPath`), никаких
 * сетевых fetch'ей: раньше произвольный URL давал SSRF (169.254.169.254,
 * 127.0.0.1, 10.0.0.0).
 */
const PHOTO_URL_PATTERN = /^\/uploads\/[a-zA-Z0-9._-]{1,128}$/;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const Schema = z.object({
  imageUrl: z
    .string()
    .min(1)
    .regex(PHOTO_URL_PATTERN, "imageUrl должен быть из /uploads/"),
  expectedKind: z.enum(["food", "equipment", "document", "any"]).default("any"),
});

const MESSAGES = {
  not_configured: "Проверка фото пока не подключена.",
  timeout: "Не успели проверить фото — попробуйте ещё раз.",
  failed: "Не получилось проверить фото — попробуйте ещё раз.",
};

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof z.ZodError ? (err.issues[0]?.message ?? "Bad input") : "Bad input" },
      { status: 400 }
    );
  }

  // Читаем файл с диска, не через сеть — никаких SSRF-векторов.
  const filePath = resolveUploadPath([body.imageUrl.slice("/uploads/".length)]);
  let bytes: Uint8Array;
  try {
    if (!filePath) throw new Error("bad path");
    const buf = await readFile(filePath);
    if (buf.length > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "Фото больше 5 МБ — оптимизируйте перед проверкой" }, { status: 400 });
    }
    bytes = new Uint8Array(buf);
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать фото" }, { status: 400 });
  }
  if (!sniffImageMime(bytes)) {
    return NextResponse.json({ error: "Проверка поддерживает фото JPG, PNG или WEBP" }, { status: 400 });
  }

  const outcome = await runVisionJob({
    purpose: "photo_check",
    instruction: buildVisionInstruction("photo_check", { expected: body.expectedKind }),
    images: [bytes],
    orgId: getActiveOrgId(auth.session),
    user: { id: auth.session.user.id, name: auth.session.user.name },
    messages: MESSAGES,
    parse: (text) => {
      const result = parsePhotoCheckReply(text);
      if (!result) console.warn(`[ai-vision] photo_check reply without JSON: ${text.slice(0, 160)}`);
      return { value: { result, raw: text.slice(0, 300) }, rows: result ? 1 : 0 };
    },
  });
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  if (!outcome.value.result) {
    return NextResponse.json({ error: "AI вернул некорректный JSON", raw: outcome.value.raw }, { status: 502 });
  }
  return NextResponse.json(outcome.value.result);
}

import { NextResponse } from "next/server";

import { buildVisionInstruction } from "@/lib/ai-vision/instructions";
import { parseVisionReply } from "@/lib/ai-vision/parse";
import { runVisionJob } from "@/lib/ai-vision/run";
import {
  VISION_MAX_PHOTOS,
  VISION_MAX_PHOTO_BYTES,
  isVisionKind,
  type VisionErrorCode,
  type VisionExtractSuccess,
  type VisionItemByKind,
  type VisionKind,
} from "@/lib/ai-vision/shared";
import { sniffImageMime } from "@/lib/ai-vision/temp-store";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/ai/vision-extract — «Распознать с фото» (кнопка «С фото»).
 *
 * multipart: 1–3 поля `photo` (JPEG/PNG/WEBP, каждое ≤ 6 МБ; клиент заранее
 * ужимает до ~1600 px) и `kind`: `menu` | `raw` | `generic`.
 * Ответ: `{ kind, items, truncated, photos, durationMs }` — строки для
 * таблицы проверки; пустой `items` — «ничего не распознали».
 * Ошибки — `{ error, code }` понятным текстом (не настроено / лимит / не
 * успели / не получилось).
 *
 * Только вошедшие: кабинет и мастер-кабинет (для сессии мастер-кабинета
 * путь открыт в `master-directory-access.ts`). Сайт к модели не ходит —
 * задание уходит диспетчеру, см. `src/lib/ai-vision/run.ts`.
 */

function error(code: VisionErrorCode, status: number, message: string) {
  return NextResponse.json({ error: message, code }, { status });
}

function isFileLike(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && typeof (value as Blob).arrayBuffer === "function";
}

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error("bad_request", 400, "Не удалось получить фото. Попробуйте ещё раз — или сделайте снимок заново.");
  }

  const kindValue = form.get("kind");
  if (!isVisionKind(kindValue)) return error("bad_request", 400, "Неизвестно, что распознавать");
  const kind: VisionKind = kindValue;

  const files = form.getAll("photo").filter(isFileLike);
  if (files.length === 0) return error("bad_request", 400, "Добавьте фото");
  if (files.length > VISION_MAX_PHOTOS) return error("bad_request", 400, `Не больше ${VISION_MAX_PHOTOS} фото за раз`);

  const images: Uint8Array[] = [];
  for (const file of files) {
    if (file.size > VISION_MAX_PHOTO_BYTES) {
      return error("too_large", 413, "Фото больше 6 МБ — сфотографируйте заново или выберите снимок поменьше");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!sniffImageMime(bytes)) return error("bad_type", 415, "Нужен снимок JPG, PNG или WEBP");
    images.push(bytes);
  }

  const result = await runVisionJob({
    purpose: kind,
    instruction: buildVisionInstruction(kind),
    images,
    orgId: getActiveOrgId(session),
    user: { id: session.user.id, name: session.user.name },
    parse: (text) => {
      const parsed = parseVisionReply(text, kind);
      if (!parsed.recognized) console.warn(`[ai-vision] reply without JSON list kind=${kind}: ${text.slice(0, 160)}`);
      return { value: parsed, rows: parsed.items.length };
    },
  });
  if (!result.ok) return error(result.code, result.status, result.error);

  const body: VisionExtractSuccess = {
    kind,
    items: result.value.items as Array<VisionItemByKind[VisionKind]>,
    truncated: result.value.truncated,
    photos: images.length,
    durationMs: result.durationMs,
  };
  return NextResponse.json(body);
}

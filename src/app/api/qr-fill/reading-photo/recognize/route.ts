import { NextResponse } from "next/server";
import { z } from "zod";

import { READING_PAID_ONLY_CODE, recognizeReading } from "@/lib/ai-vision/reading";
import { clientIp } from "@/lib/client-ip";
import { QR_FILL_RATE_LIMIT_ERROR, qrFillRateKey } from "@/lib/qr-fill-audit";
import { authorizeQrReadingPhoto } from "@/lib/qr-reading-photo";
import { qrFillRateLimiter } from "@/lib/rate-limit";
import { READING_PHOTO_DISABLED_CODE, READING_PHOTO_FIXATION_TEXT } from "@/lib/reading-photo-fixation";
import { readReadingPhoto } from "@/lib/reading-photo-store";
import { READING_PHOTO_TEXT, isReadingPhotoUrl } from "@/lib/reading-photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  kind: z.enum(["equipment", "room"]),
  objectId: z.string().min(1).max(100),
  token: z.string().min(10).max(500),
  employeeId: z.string().min(1).max(100),
  pin: z.string().max(12).optional(),
  pass: z.string().max(300).optional(),
  /** Ссылка из ответа `/api/qr-fill/reading-photo`. */
  url: z.string().max(200),
  metric: z.enum(["temperature", "humidity"]).default("temperature"),
});

/**
 * POST /api/qr-fill/reading-photo/recognize — автоввод показания со снимка,
 * уже прикреплённого к замеру (2026-09-26). Только на платном тарифе:
 * бесплатному — 402 `{ error: "Автоввод с фото — на платном тарифе",
 * code: "paid_only", tariffsHref }`; тариф проверяет сервер, не интерфейс.
 *
 * Тот же путь, что `/api/ocr/reading` (задание диспетчеру вида `reading`,
 * лимиты общие с «С фото» — в лимит идёт сотрудник, выбравший себя в форме).
 * Ответ `{ value, unit, confidence, device? }`; нечитаемое, не та единица,
 * невозможное число или сомнение модели — `value: null` (форма пишет «Не
 * разобрали цифры — введите вручную»), ничего не выдумывается. Стрелочный и
 * жидкостный термометр (`device`: dial / liquid) — до целого градуса.
 * Фотофиксация выключена — 403 `photo_disabled`.
 */
export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }
  if (!qrFillRateLimiter.consume(qrFillRateKey(clientIp(request), body.kind, body.objectId))) {
    return NextResponse.json({ error: QR_FILL_RATE_LIMIT_ERROR }, { status: 429 });
  }

  const auth = await authorizeQrReadingPhoto({
    kind: body.kind,
    objectId: body.objectId,
    token: body.token,
    employeeId: body.employeeId,
    pin: body.pin ?? null,
    pass: body.pass ?? null,
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { actor } = auth;
  if (!actor.photo.enabled) {
    return NextResponse.json(
      { error: READING_PHOTO_FIXATION_TEXT.disabledError, code: READING_PHOTO_DISABLED_CODE },
      { status: 403 }
    );
  }
  if (!actor.autofill) {
    console.info(`[reading-photo] qr recognize refused: free plan org=${actor.organizationId} user=${actor.employee.id}`);
    return NextResponse.json(
      { error: READING_PHOTO_TEXT.paidOnly, code: READING_PAID_ONLY_CODE, tariffsHref: actor.tariffsHref },
      { status: 402 }
    );
  }

  if (!isReadingPhotoUrl(body.url)) {
    return NextResponse.json({ error: "Фото не найдено — снимите ещё раз" }, { status: 400 });
  }
  const bytes = await readReadingPhoto(body.url);
  if (!bytes) {
    return NextResponse.json({ error: "Фото не найдено — снимите ещё раз" }, { status: 404 });
  }

  const outcome = await recognizeReading({
    bytes,
    orgId: actor.organizationId,
    user: { id: actor.employee.id, name: actor.employee.name },
    metric: body.metric,
  });
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  console.info(
    `[reading-photo] qr recognize kind=${body.kind} object=${body.objectId} metric=${body.metric} device=${outcome.result.device ?? "-"} value=${outcome.result.value ?? "null"} confidence=${outcome.result.confidence} org=${actor.organizationId}`
  );
  return NextResponse.json(outcome.result);
}

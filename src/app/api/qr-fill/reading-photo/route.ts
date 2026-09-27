import { NextResponse } from "next/server";

import { clientIp } from "@/lib/client-ip";
import { QR_FILL_RATE_LIMIT_ERROR, qrFillRateKey } from "@/lib/qr-fill-audit";
import type { QrObjectKind } from "@/lib/qr-object-pass";
import { authorizeQrReadingPhoto } from "@/lib/qr-reading-photo";
import { qrFillRateLimiter, readingPhotoRateLimiter } from "@/lib/rate-limit";
import { READING_PHOTO_DISABLED_CODE, READING_PHOTO_FIXATION_TEXT } from "@/lib/reading-photo-fixation";
import { READING_PHOTO_MAX_BYTES, saveReadingPhoto } from "@/lib/reading-photo-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(form: FormData, key: string, max: number): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * POST /api/qr-fill/reading-photo — фото к замеру с QR-наклейки холодильника
 * или плаката склада (кнопка «Фото» у поля температуры), 2026-09-26.
 *
 * Multipart: kind (equipment | room), objectId, token, employeeId, pass?,
 * pin?, photo. Сессии нет — проверки те же, что у сохранения замера
 * (`authorizeQrReadingPhoto`). Снимок ложится в `/uploads/readings/…`;
 * ответ `{ ok, url, autofill, tariffsHref }`: ссылку форма пришлёт вместе с
 * замером (`photo`), `autofill` — платный тариф, можно распознавать
 * (`/api/qr-fill/reading-photo/recognize`), `tariffsHref` — ссылка на
 * тарифы руководителю на бесплатном тарифе.
 *
 * Фото прикрепляется на любом тарифе — это доказательство замера, а не
 * платная возможность. Организация выключила «Фотофиксацию показаний» —
 * 403 `photo_disabled` (кнопок в форме тогда нет; отказ — для открытой
 * заранее страницы и прямых запросов).
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать фото — попробуйте ещё раз" }, { status: 400 });
  }
  const kindRaw = text(form, "kind", 20);
  const kind: QrObjectKind | null = kindRaw === "equipment" || kindRaw === "room" ? kindRaw : null;
  const objectId = text(form, "objectId", 100);
  const token = text(form, "token", 500);
  const employeeId = text(form, "employeeId", 100);
  const photo = form.get("photo");
  if (!kind || !objectId || !token || !employeeId) {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }
  if (!photo || typeof photo !== "object") {
    return NextResponse.json({ error: "Фото не загружено" }, { status: 400 });
  }
  if (!qrFillRateLimiter.consume(qrFillRateKey(clientIp(request), kind, objectId))) {
    return NextResponse.json({ error: QR_FILL_RATE_LIMIT_ERROR }, { status: 429 });
  }

  const auth = await authorizeQrReadingPhoto({
    kind,
    objectId,
    token,
    employeeId,
    pin: text(form, "pin", 12) || null,
    pass: text(form, "pass", 300) || null,
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { actor } = auth;
  if (!actor.photo.enabled) {
    console.info(`[reading-photo] upload refused: fixation off org=${actor.organizationId} user=${actor.employee.id}`);
    return NextResponse.json(
      { error: READING_PHOTO_FIXATION_TEXT.disabledError, code: READING_PHOTO_DISABLED_CODE },
      { status: 403 }
    );
  }

  const file = photo as File;
  if (file.size > READING_PHOTO_MAX_BYTES) {
    return NextResponse.json({ error: "Фото больше 6 МБ — снимите ещё раз" }, { status: 413 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!readingPhotoRateLimiter.consume(actor.employee.id)) {
    return NextResponse.json(
      { error: "Слишком много фото за сутки — введите показание без фото или попробуйте завтра." },
      { status: 429 }
    );
  }
  let saved: { url: string } | null;
  try {
    saved = await saveReadingPhoto(bytes);
  } catch (error) {
    readingPhotoRateLimiter.refund(actor.employee.id);
    console.error("[reading-photo] save failed:", error);
    return NextResponse.json({ error: "Не удалось сохранить фото — попробуйте ещё раз" }, { status: 500 });
  }
  if (!saved) {
    readingPhotoRateLimiter.refund(actor.employee.id);
    return NextResponse.json({ error: "Нужен снимок JPG, PNG или WEBP" }, { status: 415 });
  }

  console.info(
    `[reading-photo] saved kind=${kind} object=${objectId} org=${actor.organizationId} user=${actor.employee.id} kb=${Math.round(bytes.byteLength / 1024)} autofill=${actor.autofill ? 1 : 0} required=${actor.photo.required ? 1 : 0}`
  );
  return NextResponse.json({ ok: true, url: saved.url, autofill: actor.autofill, tariffsHref: actor.tariffsHref });
}

import { NextResponse } from "next/server";

import { READING_PAID_ONLY_CODE, recognizeReading } from "@/lib/ai-vision/reading";
import { sniffImageMime } from "@/lib/ai-vision/temp-store";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasPaidPlan } from "@/lib/plan-limits.server";
import { READING_PHOTO_TEXT, TARIFFS_HREF, isReadingMetric } from "@/lib/reading-photos";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type SessionUser = { role?: string | null; isRoot?: boolean | null };

/** Ссылку на тарифы видит тот, кто может открыть страницу тарифов, — руководство. */
function tariffsHrefFor(user: SessionUser): string | null {
  return hasFullWorkspaceAccess({ role: user.role ?? "", isRoot: user.isRoot === true }) ? TARIFFS_HREF : null;
}

/**
 * GET /api/ocr/reading — доступен ли автоввод с фото организации:
 * `{ autofill, tariffsHref }`. Кнопка камеры в документе журнала узнаёт
 * тариф заранее, чтобы на бесплатном не просить снимок впустую.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const autofill = await hasPaidPlan(getActiveOrgId(session));
  return NextResponse.json({ autofill, tariffsHref: autofill ? null : tariffsHrefFor(session.user) });
}

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
 * Автоввод с фото — только на платном тарифе (2026-09-26): бесплатному —
 * 402 `{ error: "Автоввод с фото — на платном тарифе", code: "paid_only" }`,
 * проверка на сервере, не только в интерфейсе.
 *
 * Контракт прежний: multipart `photo` (+ необязательный `metric`:
 * temperature | humidity — какое число нужно) → `{ value, unit, confidence }`,
 * ошибка — `{ error }`. Задание `wesetup_vision_extract` диспетчеру со
 * ссылкой на фото (подпись + 15 минут), инструкция вида `reading`, лимиты
 * общие с «С фото». См. `src/lib/ai-vision/reading.ts`.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const orgId = getActiveOrgId(session);
  if (!(await hasPaidPlan(orgId))) {
    console.info(`[reading-photo] site recognize refused: free plan org=${orgId} user=${session.user.id}`);
    return NextResponse.json(
      { error: READING_PHOTO_TEXT.paidOnly, code: READING_PAID_ONLY_CODE, tariffsHref: tariffsHrefFor(session.user) },
      { status: 402 }
    );
  }

  let file: File | null = null;
  let metricRaw: FormDataEntryValue | null = null;
  try {
    const form = await request.formData();
    const value = form.get("photo");
    file = value && typeof value === "object" ? (value as File) : null;
    metricRaw = form.get("metric");
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

  const outcome = await recognizeReading({
    bytes,
    orgId,
    user: { id: session.user.id, name: session.user.name },
    metric: isReadingMetric(metricRaw) ? metricRaw : null,
  });
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  return NextResponse.json(outcome.result);
}

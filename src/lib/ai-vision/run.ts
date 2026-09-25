import { enqueueAndWait } from "@/lib/ai-assistant/pf-client";
import { signedVisionImageUrl } from "@/lib/ai-vision/image-link";
import { buildVisionJobText, type VisionInstructionKind } from "@/lib/ai-vision/instructions";
import { resolveVisionMock } from "@/lib/ai-vision/mock";
import { shouldRetryWrongWorker } from "@/lib/ai-vision/retry";
import { checkVisionQuota } from "@/lib/ai-vision/quota";
import { VISION_MAX_PHOTOS, type VisionErrorCode } from "@/lib/ai-vision/shared";
import { deleteVisionImages, saveVisionImage, sweepExpiredVisionImages } from "@/lib/ai-vision/temp-store";
import { countVisionUsage, finishVisionUsage, forgetVisionUsage, recordVisionUsage } from "@/lib/ai-vision/usage-db";
import { resolveAssistantConfig } from "@/lib/assistant/config";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * Один прогон распознавания фото — общий для `/api/ai/vision-extract`
 * (строки номенклатуры), `/api/ocr/label` (этикетка), `/api/ocr/reading`
 * (показание дисплея) и `/api/ai/check-photo` (проверка фото-доказательства).
 * Лимиты у всех общие: одно распознавание — одна запись в журнале действий.
 *
 * Порядок: настроено ли → частота и суточные лимиты → фото во временную
 * папку → задание `wesetup_vision_extract` со ссылками (подпись + 15 минут)
 * → ждём ответ диспетчера до ~100 с → удаляем фото → разбираем ответ.
 * Фото удаляются в любом исходе (finally), забытые — подметаются.
 */

/** Сколько ждём ответ диспетчера: воркер опрашивает очередь раз в 10 с, модель думает 5–40 с. */
export const VISION_DEADLINE_MS = 100_000;

export type VisionErrorMessages = Record<"not_configured" | "timeout" | "failed" | "burst", string>;

/** Тексты по умолчанию — для списков («С фото»); маршруты с одним полем передают свои. */
export const VISION_ERRORS: VisionErrorMessages = {
  not_configured: "Распознавание с фото пока не подключено. Введите строки вручную.",
  timeout: "Не успели распознать — попробуйте ещё раз или введите строки вручную.",
  failed: "Не получилось распознать фото — попробуйте ещё раз или введите строки вручную.",
  burst: "Слишком часто — подождите минуту и попробуйте снова.",
};

/** Защита от очереди из одного человека: не больше 6 распознаваний в минуту. */
const burstLimiter = createRateLimiter({ tokensPerInterval: 6, intervalMs: 60_000 });

export type VisionRunFailure = { ok: false; code: VisionErrorCode; status: number; error: string };

export type VisionRunSuccess<T> = { ok: true; value: T; rows: number; durationMs: number };

export type VisionParseOutcome<T> = { value: T; rows: number };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(code: VisionErrorCode, status: number, error: string): VisionRunFailure {
  return { ok: false, code, status, error };
}

export async function runVisionJob<T>(input: {
  purpose: VisionInstructionKind;
  instruction: string;
  images: Uint8Array[];
  orgId: string;
  user: { id: string; name?: string | null };
  parse: (text: string) => VisionParseOutcome<T>;
  /** Свои тексты ошибок («введите значение вручную» вместо «строки»). */
  messages?: Partial<VisionErrorMessages>;
}): Promise<VisionRunSuccess<T> | VisionRunFailure> {
  const started = Date.now();
  const { purpose, images, orgId, user } = input;
  const errors: VisionErrorMessages = { ...VISION_ERRORS, ...input.messages };
  const photos = images.length;
  if (photos < 1 || photos > VISION_MAX_PHOTOS) return fail("bad_request", 400, `Нужно от 1 до ${VISION_MAX_PHOTOS} фото`);

  const mock = resolveVisionMock(process.env, purpose);
  const config = mock ? null : await resolveAssistantConfig();
  if (!mock && !config) {
    console.warn(`[ai-vision] not configured purpose=${purpose} org=${orgId}`);
    return fail("not_configured", 503, errors.not_configured);
  }

  if (!burstLimiter.consume(user.id)) return fail("limit", 429, errors.burst);
  const verdict = checkVisionQuota(await countVisionUsage({ orgId, userId: user.id }));
  if (!verdict.ok) {
    console.warn(`[ai-vision] daily limit (${verdict.scope}) org=${orgId} user=${user.id}`);
    return fail("limit", 429, verdict.error);
  }

  await sweepExpiredVisionImages().catch(() => 0);
  const saved: string[] = [];
  try {
    for (const bytes of images) {
      const file = await saveVisionImage(bytes);
      if (!file) return fail("bad_type", 415, "Нужен снимок JPG, PNG или WEBP");
      saved.push(file.id);
    }

    const usageId = await recordVisionUsage({ orgId, userId: user.id, userName: user.name, visionKind: purpose, photos });
    const bytes = images.reduce((sum, image) => sum + image.byteLength, 0);
    console.info(
      `[ai-vision] start purpose=${purpose} photos=${photos} kb=${Math.round(bytes / 1024)} org=${orgId} user=${user.id}${mock ? " mock" : ""}`
    );

    const baseUrl = config?.publicBaseUrl ?? (process.env.NEXTAUTH_URL || "http://localhost:3000");
    const jobText = buildVisionJobText({
      imageUrls: saved.map((id) => signedVisionImageUrl(baseUrl, id)),
      instruction: input.instruction,
    });

    let reply: { ok: true; text: string } | { ok: false; code: string };
    if (mock) {
      if (mock.delayMs > 0) await sleep(mock.delayMs);
      reply = mock.outcome === "reply" ? { ok: true, text: mock.text } : { ok: false, code: mock.outcome === "timeout" ? "timeout" : "job_failed" };
    } else {
      const deadline = started + VISION_DEADLINE_MS;
      let result = await enqueueAndWait(jobText, { deadlineMs: VISION_DEADLINE_MS });
      // Воркер без поддержки фото (старая версия, пока её не перезапустили)
      // закрывает такие задания «wrong_worker» за секунды. Ставим задание
      // заново — его заберёт воркер с поддержкой фото.
      for (let attempt = 1; shouldRetryWrongWorker(result, attempt, deadline - Date.now()); attempt += 1) {
        console.warn(`[ai-vision] wrong_worker, retry ${attempt} purpose=${purpose} org=${orgId}`);
        result = await enqueueAndWait(jobText, { deadlineMs: deadline - Date.now() });
      }
      reply = result.ok ? { ok: true, text: result.text } : { ok: false, code: result.code };
    }
    const durationMs = Date.now() - started;

    if (!reply.ok) {
      console.error(`[ai-vision] failed purpose=${purpose} code=${reply.code} ms=${durationMs} org=${orgId}`);
      if (reply.code === "enqueue_failed" || reply.code === "not_configured") await forgetVisionUsage(usageId);
      else await finishVisionUsage(usageId, { visionKind: purpose, photos, result: reply.code === "timeout" ? "timeout" : "failed", durationMs });
      if (reply.code === "not_configured") return fail("not_configured", 503, errors.not_configured);
      if (reply.code === "timeout") return fail("timeout", 504, errors.timeout);
      return fail("failed", 502, errors.failed);
    }

    let parsed: VisionParseOutcome<T>;
    try {
      parsed = input.parse(reply.text);
    } catch (error) {
      console.error(`[ai-vision] parse error purpose=${purpose}:`, error);
      await finishVisionUsage(usageId, { visionKind: purpose, photos, result: "failed", durationMs });
      return fail("failed", 502, errors.failed);
    }
    await finishVisionUsage(usageId, {
      visionKind: purpose,
      photos,
      result: parsed.rows > 0 ? "ok" : "empty",
      recognized: parsed.rows,
      durationMs,
    });
    console.info(`[ai-vision] done purpose=${purpose} rows=${parsed.rows} ms=${durationMs} chars=${reply.text.length} org=${orgId}`);
    return { ok: true, value: parsed.value, rows: parsed.rows, durationMs };
  } finally {
    // Фото нужны только воркеру — после ответа (или ошибки) их не держим.
    await deleteVisionImages(saved).catch(() => 0);
  }
}

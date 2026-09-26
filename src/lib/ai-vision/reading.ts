import { buildVisionInstruction } from "@/lib/ai-vision/instructions";
import { parseReadingReply, type VisionReadingResult } from "@/lib/ai-vision/parse";
import { runVisionJob } from "@/lib/ai-vision/run";
import { acceptRecognizedReading, type ReadingMetric } from "@/lib/reading-photos";

/**
 * Показание дисплея со снимка — общий путь для `/api/ocr/reading` (кнопка
 * камеры в документе журнала) и `/api/qr-fill/reading-photo/recognize`
 * (кнопка «Фото» в QR-форме): задание диспетчеру вида `reading`, лимиты
 * общие с «С фото» (`runVisionJob`).
 *
 * Когда известен показатель (`metric`), число проверяется под поле: не та
 * единица или невозможное значение — `value: null`, как нечитаемый снимок.
 * Выдумывать нельзя: пустое поле с просьбой ввести вручную лучше чужого
 * числа в журнале.
 */

const MESSAGES = {
  not_configured: "Распознавание показаний пока не подключено — введите значение вручную.",
  timeout: "Не успели распознать показание — попробуйте ещё раз или введите значение вручную.",
  failed: "Не получилось распознать показание — попробуйте ещё раз или введите значение вручную.",
};

/** Код и текст отказа бесплатному тарифу — одни для сайта и QR-формы. */
export const READING_PAID_ONLY_CODE = "paid_only";

export type ReadingRecognizeOutcome =
  | { ok: true; result: VisionReadingResult }
  | { ok: false; status: number; error: string };

const UNREADABLE: VisionReadingResult = { value: null, unit: null, confidence: "low" };

export async function recognizeReading(input: {
  bytes: Uint8Array;
  orgId: string;
  user: { id: string; name?: string | null };
  metric?: ReadingMetric | null;
}): Promise<ReadingRecognizeOutcome> {
  const metric = input.metric ?? null;
  const outcome = await runVisionJob({
    purpose: "reading",
    instruction: buildVisionInstruction("reading", metric ? { metric } : {}),
    images: [input.bytes],
    orgId: input.orgId,
    user: input.user,
    messages: MESSAGES,
    parse: (text) => {
      const parsed = parseReadingReply(text);
      if (!parsed) {
        console.warn(`[ai-vision] reading reply without JSON: ${text.slice(0, 160)}`);
        return { value: null, rows: 0 };
      }
      if (!metric) return { value: parsed, rows: parsed.value !== null ? 1 : 0 };
      const value = acceptRecognizedReading(parsed, metric);
      if (value === null && parsed.value !== null) {
        console.warn(`[ai-vision] reading rejected for ${metric}: value=${parsed.value} unit=${parsed.unit ?? "-"}`);
      }
      const result: VisionReadingResult = value === null ? UNREADABLE : { ...parsed, value };
      return { value: result, rows: value === null ? 0 : 1 };
    },
  });
  if (!outcome.ok) return { ok: false, status: outcome.status, error: outcome.error };
  if (!outcome.value) return { ok: false, status: 422, error: "Не удалось разобрать ответ. Попробуйте другое фото." };
  return { ok: true, result: outcome.value };
}

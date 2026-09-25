import type { PfJobResult } from "@/lib/ai-assistant/pf-client";

/** Сколько раз переставить задание, которое закрыл воркер без поддержки фото. */
export const VISION_WRONG_WORKER_RETRIES = 5;

/** Меньше этого времени до дедлайна новую попытку не начинаем: воркер не успеет. */
export const VISION_RETRY_MIN_MS_LEFT = 15_000;

/**
 * Переставить ли задание распознавания заново.
 *
 * Пока рядом работает старый воркер (без типа `wesetup_vision_extract`), он
 * может забрать задание раньше нового и закрыть его ошибкой
 * `wrong_worker:<тип>`. Такой отказ — не ответ модели, а промах очереди:
 * повторяем, пока есть попытки и время. Любую другую ошибку не повторяем.
 */
export function shouldRetryWrongWorker(result: PfJobResult, attempt: number, msLeft: number): boolean {
  if (result.ok || result.code !== "job_failed") return false;
  if (!result.workerError?.startsWith("wrong_worker")) return false;
  return attempt <= VISION_WRONG_WORKER_RETRIES && msLeft > VISION_RETRY_MIN_MS_LEFT;
}

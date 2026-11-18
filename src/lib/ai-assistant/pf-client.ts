import { resolveAssistantConfig, type AssistantConfig } from "@/lib/assistant/config";

/**
 * Транспорт AI-запросов сайта в диспетчер ProjectsFlow.
 *
 * Сайт к языковой модели НЕ ходит (ни Anthropic, ни какой-либо другой
 * ключ на проде не нужен). Каждый запрос — задание в невидимой очереди
 * `ai-prompt-jobs` (mode: "assistant"): карточек на доске оно не
 * создаёт, терминальные записи ProjectsFlow чистит сам через 7 дней.
 *
 * Паттерн «submit + long-poll» повторяет перефразирование текстов в
 * ProjectsFlow (HttpAiPromptRepository): POST кладёт задание, дальше
 * GET ...?wait=25 держится сервером до терминального статуса. 504 от
 * long-poll — НЕ ошибка, это «ещё в очереди», повторяем до дедлайна.
 *
 * Контракт минимальный — строка на входе (`inputText`, вся инструкция
 * самодостаточна), строка на выходе (`improvedText`). Исполнитель —
 * диспетчерская сессия Claude Code проекта Wesetup: claim → выполнить
 * инструкцию → complete. Никаких callback'ов на запись исполнителю не
 * выдаём.
 */

const ENQUEUE_TIMEOUT_MS = 15_000;
/** Сколько секунд держит одно long-poll соединение ProjectsFlow. */
const POLL_WAIT_SECONDS = 25;
/** Запас поверх wait на сетевые накладные расходы. */
const POLL_TIMEOUT_MS = (POLL_WAIT_SECONDS + 10) * 1000;
/**
 * Общий дедлайн ожидания ответа. Диспетчер отвечает за 10–60 секунд;
 * cleanup ProjectsFlow отменит assistant-задание через 15 минут, но
 * держать HTTP-запрос виджета столько бессмысленно.
 */
const DEFAULT_DEADLINE_MS = 90_000;

export type PfJobResult =
  | { ok: true; text: string; jobId: string }
  | {
      ok: false;
      error: string;
      code: "not_configured" | "enqueue_failed" | "timeout" | "job_failed";
      /** Сырая причина от исполнителя (например `wrong_worker:<тип>`) — только у job_failed. */
      workerError?: string;
    };

type PfJobStatusResponse = {
  jobId?: string;
  status?: string;
  improvedText?: string | null;
  error?: string | null;
};

type PfSubmission = { ok: true; jobId: string } | Extract<PfJobResult, { ok: false }>;

export async function enqueuePfJob(inputText: string, suppliedConfig?: AssistantConfig): Promise<PfSubmission> {
  const config = suppliedConfig ?? await resolveAssistantConfig();
  if (!config) return { ok: false, code: "not_configured", error: "??-???????? ?????????? ? ?????????? ?? ?????????" };
  // 1. Enqueue.
  try {
    const response = await fetch(`${config.pfApiUrl}/agent/ai-prompt-jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.pfToken}`,
      },
      body: JSON.stringify({
        text: inputText,
        projectId: config.pfProjectId,
        mode: "assistant",
      }),
      signal: AbortSignal.timeout(ENQUEUE_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(
        `[ai-pf] enqueue failed: ${response.status} ${detail.slice(0, 200)}`
      );
      return {
        ok: false,
        code: "enqueue_failed",
        error:
          response.status === 429
            ? "Слишком много AI-запросов, подождите минуту"
            : "Не удалось связаться с ИИ-помощником. Попробуйте ещё раз",
      };
    }
    const data = (await response.json().catch(() => null)) as {
      jobId?: string;
      id?: string;
    } | null;
    const id = data?.jobId ?? data?.id ?? null;
    if (!id) {
      return {
        ok: false,
        code: "enqueue_failed",
        error: "Не удалось поставить AI-задание. Попробуйте ещё раз",
      };
    }
    return { ok: true, jobId: id };
  } catch (error) {
    console.error("[ai-pf] enqueue error:", error);
    return {
      ok: false,
      code: "enqueue_failed",
      error: "Не удалось связаться с ИИ-помощником. Попробуйте ещё раз",
    };
  }

}

export async function readPfJob(jobId: string): Promise<{ status: "waiting" | "failed" } | { status: "succeeded"; text: string }> {
  if (!/^[a-z0-9_-]{1,160}$/i.test(jobId)) return { status: "failed" };
  const config = await resolveAssistantConfig();
  if (!config) return { status: "waiting" };
  const response = await fetch(`${config.pfApiUrl}/agent/ai-prompt-jobs/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${config.pfToken}` },
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) return { status: "failed" };
  if (!response.ok) return { status: "waiting" };
  const job = (await response.json()) as PfJobStatusResponse;
  if (job.status === "succeeded") return { status: "succeeded", text: job.improvedText ?? "" };
  return { status: job.status === "failed" || job.status === "cancelled" ? "failed" : "waiting" };
}

export async function enqueueAndWait(
  inputText: string,
  options?: { deadlineMs?: number }
): Promise<PfJobResult> {
  const config = await resolveAssistantConfig();
  if (!config) return { ok: false, code: "not_configured", error: "??-???????? ?????????? ? ?????????? ?? ?????????" };
  const deadline = Date.now() + (options?.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const submission = await enqueuePfJob(inputText, config);
  if (!submission.ok) return submission;
  const { jobId } = submission;

  // 2. Long-poll до терминального статуса или дедлайна.
  while (Date.now() < deadline) {
    let response: Response;
    try {
      response = await fetch(
        `${config.pfApiUrl}/agent/ai-prompt-jobs/${jobId}?wait=${POLL_WAIT_SECONDS}`,
        {
          headers: { Authorization: `Bearer ${config.pfToken}` },
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        }
      );
    } catch (error) {
      // Сетевая ошибка одного poll'а — не приговор, пробуем ещё,
      // пока не выйдет дедлайн.
      console.warn("[ai-pf] poll network error:", error);
      continue;
    }

    // 504 = long-poll истёк, задание ещё в очереди. Повторяем.
    if (response.status === 504) continue;

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(
        `[ai-pf] poll failed: ${response.status} ${detail.slice(0, 200)}`
      );
      return {
        ok: false,
        code: "job_failed",
        error: "ИИ-помощник не смог обработать запрос. Попробуйте ещё раз",
      };
    }

    const job = (await response
      .json()
      .catch(() => null)) as PfJobStatusResponse | null;
    if (!job) continue;

    if (job.status === "succeeded") {
      return { ok: true, text: job.improvedText ?? "", jobId };
    }
    if (job.status === "failed" || job.status === "cancelled") {
      console.error(`[ai-pf] job ${jobId} ${job.status}: ${job.error ?? ""}`);
      return {
        ok: false,
        code: "job_failed",
        workerError: job.error ?? undefined,
        error:
          job.error === "dispatcher_timeout"
            ? "ИИ-помощник не ответил вовремя. Попробуйте ещё раз"
            : "ИИ-помощник не смог обработать запрос. Попробуйте ещё раз",
      };
    }
    // queued / running — ждём дальше.
  }

  return {
    ok: false,
    code: "timeout",
    error: "ИИ-помощник не ответил вовремя. Попробуйте ещё раз",
  };
}

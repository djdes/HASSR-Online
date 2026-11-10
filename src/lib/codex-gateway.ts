/**
 * Codex-шлюз ProjectsFlow: тексты и картинки по подписке через очередь
 * `projectsflow.ru/api/ai/*` (исполняет диспетчер Ralph). Контракт:
 * https://github.com/djdes/ProjectsFlow/blob/main/docs/codex-gateway.md
 *
 * Задачи асинхронные: здесь — короткие шаги «поставить» и «проверить»,
 * чтобы крон не держал запрос минутами. Токен — `CODEX_GATEWAY_TOKEN`
 * (scope `account`), только из .env; в логи не пишется ни он, ни текст.
 */

export type GatewayJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export class CodexGatewayError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
    this.name = "CodexGatewayError";
  }
}

const base = () => (process.env.CODEX_GATEWAY_URL?.trim() || "https://projectsflow.ru/api").replace(/\/+$/, "");
const token = () => process.env.CODEX_GATEWAY_TOKEN?.trim() ?? "";

export function codexGatewayConfigured(): boolean {
  return token().length > 0;
}

function headers(): Record<string, string> {
  const value = token();
  if (!value) throw new CodexGatewayError("Не задан CODEX_GATEWAY_TOKEN — шлюз ProjectsFlow не подключён.");
  return { Authorization: `Bearer ${value}` };
}

async function readError(response: Response, what: string): Promise<CodexGatewayError> {
  const body = (await response.text().catch(() => "")).slice(0, 200);
  const hint =
    response.status === 401 || response.status === 403
      ? "шлюз не принял токен (нужен токен агента со scope account)"
      : response.status === 429
        ? "превышен лимит шлюза"
        : response.status === 503
          ? "диспетчер ProjectsFlow не запущен"
          : body || `ответ ${response.status}`;
  return new CodexGatewayError(`${what}: ${hint}`, response.status);
}

export async function startTextJob(input: string, instructions?: string): Promise<string> {
  const response = await fetch(`${base()}/ai/text-jobs`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(instructions ? { input, instructions } : { input }),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 202) throw await readError(response, "Текст не поставлен в очередь");
  const { id } = (await response.json()) as { id: string };
  console.info(`[codex-gateway] text job ${id} queued, input=${input.length}`);
  return id;
}

export async function readTextJob(id: string): Promise<{ status: GatewayJobStatus; text: string | null; error: string | null }> {
  const response = await fetch(`${base()}/ai/text-jobs/${encodeURIComponent(id)}?wait=5`, {
    headers: headers(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw await readError(response, "Не прочитан статус текста");
  const job = (await response.json()) as { status: GatewayJobStatus; text: string | null; error: string | null };
  return { status: job.status, text: job.text ?? null, error: job.error ?? null };
}

export async function imageQuota(): Promise<{ active: number; remaining: number }> {
  const response = await fetch(`${base()}/ai/image-jobs/quota`, { headers: headers(), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw await readError(response, "Не прочитан лимит картинок");
  const quota = (await response.json()) as { active?: number; remaining?: number };
  return { active: Number(quota.active ?? 0), remaining: Number(quota.remaining ?? 0) };
}

export async function startImageJob(prompt: string, size: { width: number; height: number }): Promise<string> {
  const form = new FormData();
  form.set("prompt", prompt.slice(0, 8000));
  form.set("width", String(size.width));
  form.set("height", String(size.height));
  const response = await fetch(`${base()}/ai/image-jobs`, {
    method: "POST",
    headers: headers(),
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 202) throw await readError(response, "Картинка не поставлена в очередь");
  const { id } = (await response.json()) as { id: string };
  console.info(`[codex-gateway] image job ${id} queued ${size.width}x${size.height}`);
  return id;
}

export async function readImageJob(id: string): Promise<{ status: GatewayJobStatus; error: string | null }> {
  const response = await fetch(`${base()}/ai/image-jobs/${encodeURIComponent(id)}`, {
    headers: headers(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw await readError(response, "Не прочитан статус картинки");
  const job = (await response.json()) as { status: GatewayJobStatus; error: string | null };
  return { status: job.status, error: job.error ?? null };
}

export async function downloadImage(id: string): Promise<Buffer> {
  const response = await fetch(`${base()}/ai/image-jobs/${encodeURIComponent(id)}/image`, {
    headers: headers(),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw await readError(response, "Картинка не скачана");
  return Buffer.from(await response.arrayBuffer());
}

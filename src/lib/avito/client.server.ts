/**
 * API Авито (приложение «WeSetup CRM»): токен по client_credentials для
 * собственного аккаунта, AVITO_CLIENT_ID / AVITO_CLIENT_SECRET в .env.
 * Токен живёт сутки — держим в памяти процесса и берём новый за минуту до конца.
 */
const API = "https://api.avito.ru";

let cached: { token: string; until: number } | null = null;

export function avitoConfigured(): boolean {
  return Boolean(process.env.AVITO_CLIENT_ID?.trim() && process.env.AVITO_CLIENT_SECRET?.trim());
}

export class AvitoApiError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
    this.name = "AvitoApiError";
  }
}

async function token(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.AVITO_CLIENT_ID?.trim() ?? "",
    client_secret: process.env.AVITO_CLIENT_SECRET?.trim() ?? "",
  });
  const response = await fetch(`${API}/token`, { method: "POST", body, signal: AbortSignal.timeout(20_000) });
  const data = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !data.access_token) throw new AvitoApiError(`Авито не выдал токен: ${data.error ?? response.status}`, response.status);
  cached = { token: data.access_token, until: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 60) * 1000 };
  return cached.token;
}

export async function avitoFetch<T>(path: string, init: { method?: string; json?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const send = async () =>
    fetch(`${API}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${await token()}`, ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}), ...init.headers },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  let response = await send();
  if (response.status === 401) {
    cached = null;
    response = await send();
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => "")).slice(0, 200);
    throw new AvitoApiError(`Авито ответил ${response.status}${text ? `: ${text}` : ""}`, response.status);
  }
  return (await response.json()) as T;
}

/** Id нашего аккаунта Авито (`/core/v1/accounts/self`). */
export async function avitoOwnUser(): Promise<{ id: string; name: string }> {
  const self = await avitoFetch<{ id: number; name?: string }>("/core/v1/accounts/self");

  return { id: String(self.id), name: self.name?.trim() || "Авито" };
}

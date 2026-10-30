// Saby (СБИС) JSON-RPC — нижний слой ЭДО: один POST с телом
// {"jsonrpc":"2.0","method":…,"params":…,"id":0}, доступ — заголовок X-SBISAccessToken.
// Вход — по ключам приложения (ID подключения + защищённый ключ) на /oauth/service/.
// Здесь только транспорт и разбор ошибок; формы ответов конкретных методов знают модули выше.
// Перенесено из DocsFlow (`src/lib/edo/saby/rpc.ts`), проверено там на живом кабинете 23.10.2026.
// Файл чистый: ни prisma, ни `@/`-алиасов — тесты гоняют его без БД.

/**
 * Ошибка вызова Saby. `code` — classid из `error.data.classid`, а если его нет — `error.code`;
 * для сбоев вне JSON-RPC: `http_<статус>`, `bad_response` (тело не того формата), `timeout`.
 */
export class SabyRpcError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly details?: string;

  constructor(httpStatus: number, code: string, message: string, details?: string) {
    super(message);
    this.name = "SabyRpcError";
    this.httpStatus = httpStatus;
    this.code = code;
    this.details = details;
  }
}

/** Ключи приложения Saby: подключение создаётся в кабинете, один набор — один кабинет. */
export interface SabyAppCreds {
  /** Например `https://online.saby.ru` или тестовый контур `https://fix-online.sbis.ru`. */
  baseUrl: string;
  /** ID подключения (`app_client_id`) — не секрет, хранится открыто. */
  clientId: string;
  /** Защищённый ключ (`app_secret`) — секрет, в ответах API и логах не светится. */
  appSecret: string;
}

/** Сессия по ключам приложения: `accessToken` — для методов, `token` — для выхода. */
export interface SabyAppSession {
  accessToken: string;
  token: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 30_000;
/** Выход не должен подолгу держать вызывающего: сессию всё равно выбрасываем. */
const LOGOUT_TIMEOUT_MS = 10_000;
const JSON_UTF8 = "application/json; charset=utf-8";

/** Код отказа входа по ключам: любой 4xx на входе, кроме 408 и 429, или ответ без токена. */
const APP_LOGIN_FAILED = "app_login_failed";
const APP_KEYS_HINT = "Saby не выдал токен — проверьте ID подключения и защищённый ключ";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Разбор блока `error` из тела ответа; null — в теле ошибки JSON-RPC нет. */
function readRpcError(body: unknown): { code: string; message: string; details?: string } | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const err = body.error;
  const classid = isRecord(err.data) && typeof err.data.classid === "string" ? err.data.classid : "";
  const numeric = typeof err.code === "number" || typeof err.code === "string" ? String(err.code) : "";
  return {
    code: classid || numeric || "rpc_error",
    message: typeof err.message === "string" && err.message ? err.message : "Ошибка Saby",
    details: typeof err.details === "string" && err.details ? err.details : undefined,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Один POST. Таймаут накрывает и ожидание ответа, и чтение тела; по таймауту — `SabyRpcError`
 * `timeout`, сетевой сбой fetch (TypeError) пробрасывается как есть.
 */
async function postWithTimeout(
  url: string,
  headers: Record<string, string>,
  body: string,
  fetchImpl: FetchLike | undefined,
  timeoutMs: number,
): Promise<{ status: number; ok: boolean; text: string }> {
  const doFetch: FetchLike = fetchImpl ?? ((u, init) => fetch(u, init));
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await doFetch(url, { method: "POST", headers, body, signal: controller.signal });
    return { status: res.status, ok: res.ok, text: await res.text() };
  } catch (e) {
    if (timedOut) throw new SabyRpcError(0, "timeout", `Saby не ответил за ${Math.ceil(timeoutMs / 1000)} с`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Один вызов JSON-RPC. Возвращает `result`; любой отказ — `SabyRpcError` (ошибка из тела,
 * HTTP-статус не 2xx, тело не того формата, таймаут). Сетевой сбой fetch (TypeError)
 * пробрасывается как есть.
 */
export async function sabyRpc<T>(
  url: string,
  method: string,
  params: unknown,
  opts: { accessToken?: string; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json-rpc;charset=utf-8" };
  if (opts.accessToken) headers["X-SBISAccessToken"] = opts.accessToken;
  const body = JSON.stringify({ jsonrpc: "2.0", method, params, id: 0 });

  const { status, ok, text } = await postWithTimeout(url, headers, body, opts.fetchImpl, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const parsed = parseJson(text);

  // Ошибку из тела читаем и при не-2xx: Saby кладёт причину (например, «сессия не найдена»)
  // в JSON даже при 401/500, а HTTP-статус остаётся тем, что пришёл.
  const rpcError = readRpcError(parsed);
  if (rpcError) throw new SabyRpcError(status, rpcError.code, rpcError.message, rpcError.details);
  if (!ok) throw new SabyRpcError(status, `http_${status}`, `Saby ответил HTTP ${status}`);
  if (!isRecord(parsed) || !("result" in parsed)) {
    throw new SabyRpcError(status, "bad_response", "Saby вернул ответ без result и без error");
  }
  return parsed.result as T;
}

/**
 * Причина отказа входа из тела ответа Saby (`{"error": "<текст>"}`); пусто, если её там нет.
 * Обёртку «Не удалось осуществить авторизацию. [0] (ОПИСАНИЕ: …)» снимаем, оставляя суть;
 * защищённый ключ, если Saby вдруг вернул его в тексте, заменяем на «***».
 */
function readLoginReason(body: unknown, appSecret: string): string {
  if (!isRecord(body) || typeof body.error !== "string") return "";
  let reason = body.error.trim();
  const inner = /\(ОПИСАНИЕ:\s*([\s\S]*)\)\s*$/.exec(reason);
  if (inner) reason = inner[1].trim();
  if (appSecret) reason = reason.split(appSecret).join("***");
  return reason.slice(0, 300);
}

/**
 * Вход по ключам приложения: `POST {baseUrl}/oauth/service/` с `{app_client_id, app_secret}`
 * отдаёт `{access_token, sid, token}`. `access_token` идёт в методы, `token` — в выход; если
 * Saby прислал только один из них, он годится на обе роли.
 * Любой 4xx, кроме 408 и 429, и ответ без токена — неверные ключи (`app_login_failed`);
 * 5xx, 408 и 429 — обычные `http_<статус>` (временный сбой). Ключ в текст ошибок не попадает.
 */
export async function sabyAppLogin(creds: SabyAppCreds, fetchImpl?: FetchLike): Promise<SabyAppSession> {
  const base = creds.baseUrl.replace(/\/+$/, "");
  const body = JSON.stringify({ app_client_id: creds.clientId, app_secret: creds.appSecret });
  const res = await postWithTimeout(`${base}/oauth/service/`, { "Content-Type": JSON_UTF8 }, body, fetchImpl, DEFAULT_TIMEOUT_MS);

  const parsed = parseJson(res.text);

  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    const reason = readLoginReason(parsed, creds.appSecret);
    throw new SabyRpcError(
      res.status,
      APP_LOGIN_FAILED,
      reason ? `${APP_KEYS_HINT}. Saby: ${reason}` : APP_KEYS_HINT,
      reason || undefined,
    );
  }
  if (!res.ok) throw new SabyRpcError(res.status, `http_${res.status}`, `Saby ответил HTTP ${res.status}`);

  const pick = (key: string) => (isRecord(parsed) && typeof parsed[key] === "string" ? (parsed[key] as string) : "");
  const accessToken = pick("access_token") || pick("token");
  if (!accessToken) throw new SabyRpcError(res.status, APP_LOGIN_FAILED, APP_KEYS_HINT);
  return { accessToken, token: pick("token") || accessToken };
}

/**
 * Выход (`POST {baseUrl}/oauth/service/` с `{event:"exit", token}`): освобождает один из пяти
 * слотов сессий приложения. Любой сбой глотает: выход делается по возможности.
 */
export async function sabyAppLogout(baseUrl: string, token: string, fetchImpl?: FetchLike): Promise<void> {
  const base = baseUrl.replace(/\/+$/, "");
  try {
    await postWithTimeout(
      `${base}/oauth/service/`,
      { "Content-Type": JSON_UTF8 },
      JSON.stringify({ event: "exit", token }),
      fetchImpl,
      LOGOUT_TIMEOUT_MS,
    );
  } catch {
    // Выход — по возможности: сессия и так будет выброшена.
  }
}

/**
 * Сбой временный: сеть, таймаут, 408, 429, 5xx без разбираемого тела. Ошибка JSON-RPC из тела —
 * ответ Saby по существу («Нет прав», «Документ не найден»), она не временная.
 */
export function isTransientSabyError(e: unknown): boolean {
  if (e instanceof SabyRpcError) {
    if (e.code === "timeout" || e.httpStatus === 408 || e.httpStatus === 429) return true;
    return e.httpStatus >= 500 && e.code.startsWith("http_");
  }
  return e instanceof TypeError;
}

/** Saby не пустил по ключам приложения: до метода дело не дошло. */
export function isSabyAppLoginError(e: unknown): boolean {
  return e instanceof SabyRpcError && e.code === APP_LOGIN_FAILED;
}

/** Текст сбоя для человека. */
export function describeSabyError(e: unknown): string {
  if (e instanceof SabyRpcError) {
    const fromHttp = e.code.startsWith("http_");
    const serverText = fromHttp ? "" : e.message;

    if (e.code === APP_LOGIN_FAILED) {
      return `Saby не принял ключи приложения — проверьте ID подключения и защищённый ключ${e.details ? ` (Saby: ${e.details})` : ""}`;
    }
    if (e.httpStatus === 429) {
      return "Saby ограничил частоту запросов — блокировка обычно снимается через 10–20 минут";
    }
    if (e.httpStatus === 401) {
      return `Saby отклонил авторизацию: сессия недействительна или неверны ключи приложения${serverText ? ` (${serverText})` : ""}`;
    }
    if (e.code === "timeout" || e.httpStatus === 408) return "Saby не ответил вовремя";
    if (e.code === "bad_response") return "Saby вернул ответ неожиданного формата";
    if (e.httpStatus >= 500 && fromHttp) return `Saby временно недоступен (HTTP ${e.httpStatus})`;
    if (fromHttp) return e.message;
    return `Ошибка Saby: ${e.message}${e.details && e.details !== e.message ? ` — ${e.details}` : ""}`;
  }
  if (e instanceof TypeError) return `Нет связи с Saby (${e.message})`;
  if (e instanceof Error) return e.message;
  return String(e);
}

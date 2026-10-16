import { authenticateApiKey } from "../auth";
import { runTool } from "../run-tool";
import { PUBLIC_API_TOOLS } from "../tools";
import { handleMcpBody } from "./handle-message";
import { RPC } from "./protocol";

/**
 * HTTP-обвязка MCP-эндпоинта (Streamable HTTP): Origin, CORS, ключ,
 * разбор тела. Отвечаем всегда одним JSON — SSE не нужен: инструменты
 * быстрые, уведомлений сервер не шлёт.
 */

const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_ORIGINS = new Set([
  "https://wesetup.ru",
  "https://www.wesetup.ru",
  "https://claude.ai",
  "https://chatgpt.com",
  "https://chat.openai.com",
]);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const ALLOW_HEADERS =
  "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID";

function envOrigins(): string[] {
  return (process.env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Защита от DNS rebinding (спецификация MCP: чужой Origin → 403). */
export function isAllowedOrigin(origin: string | null, extra: string[] = envOrigins()): boolean {
  if (origin === null) return true;
  return DEFAULT_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin) || extra.includes(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Expose-Headers": "WWW-Authenticate",
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function mcpPreflight(request: Request): Response {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders(origin), "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400" },
  });
}

export function mcpMethodNotAllowed(): Response {
  return json(405, { jsonrpc: "2.0", id: null, error: { code: RPC.invalidRequest, message: "Use POST" } }, { Allow: "POST, OPTIONS" });
}

export async function handleMcpHttp(request: Request, opts: { pathKey?: string } = {}): Promise<Response> {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return json(403, { jsonrpc: "2.0", id: null, error: { code: RPC.invalidRequest, message: "Origin not allowed" } });
  }
  const cors = corsHeaders(origin);

  const auth = await authenticateApiKey(request, { via: "mcp", pathKey: opts.pathKey });
  if (!auth.ok) {
    const headers: Record<string, string> = { ...cors };
    if (auth.status === 401) headers["WWW-Authenticate"] = 'Bearer realm="WeSetup"';
    if (auth.retryAfterSec) headers["Retry-After"] = String(auth.retryAfterSec);
    return json(auth.status, { jsonrpc: "2.0", id: null, error: { code: RPC.unauthorized, message: auth.error } }, headers);
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return json(413, { jsonrpc: "2.0", id: null, error: { code: RPC.invalidRequest, message: "Body too large" } }, cors);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json(413, { jsonrpc: "2.0", id: null, error: { code: RPC.invalidRequest, message: "Body too large" } }, cors);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { jsonrpc: "2.0", id: null, error: { code: RPC.parse, message: "Parse error" } }, cors);
  }

  const reply = await handleMcpBody(body, {
    headers: request.headers,
    ctx: auth.ctx,
    tools: PUBLIC_API_TOOLS,
    run: (tool, args, ctx) => runTool(tool, args, ctx),
  });
  return json(reply.status, reply.body, cors);
}

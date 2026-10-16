import { db } from "@/lib/db";
import { prismaIdempotencyStore } from "@/lib/idempotency";
import { authenticateApiKey, publicBaseUrl } from "../auth";
import { runTool } from "../run-tool";
import { PUBLIC_API_TOOLS } from "../tools";
import { restIdempotencyKey, runIdempotent } from "./idempotency";
import { buildOpenApiDocument } from "./openapi";
import { matchRestRoute } from "./router";

/**
 * REST API v1: те же инструменты, что у MCP, обычными HTTP-методами.
 * Ответ — `{ ok: true, data }` или `{ ok: false, error }`.
 */

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export async function handleRestRequest(request: Request, segments: string[]): Promise<Response> {
  const baseUrl = publicBaseUrl();
  if (segments.length === 0) {
    return json(200, {
      name: "WeSetup API",
      version: "1.0.0",
      openapi: `${baseUrl}/api/v1/openapi.json`,
      docs: `${baseUrl}/developers`,
      mcp: `${baseUrl}/api/mcp`,
    });
  }
  if (segments.length === 1 && segments[0] === "openapi.json" && request.method === "GET") {
    return json(200, buildOpenApiDocument(PUBLIC_API_TOOLS, baseUrl), { "Cache-Control": "public, max-age=3600" });
  }

  const match = matchRestRoute(request.method, segments, PUBLIC_API_TOOLS);
  if (match.kind === "not_found") return json(404, { ok: false, error: "Нет такого метода API" });
  if (match.kind === "method_not_allowed") {
    return json(405, { ok: false, error: "Метод не поддерживается" }, { Allow: match.allow.join(", ") });
  }

  const auth = await authenticateApiKey(request, { via: "rest" });
  if (!auth.ok) {
    const headers: Record<string, string> = {};
    if (auth.status === 401) headers["WWW-Authenticate"] = 'Bearer realm="WeSetup"';
    if (auth.retryAfterSec) headers["Retry-After"] = String(auth.retryAfterSec);
    return json(auth.status, { ok: false, error: auth.error }, headers);
  }
  const { ctx } = auth;

  let input: Record<string, unknown>;
  if (request.method === "GET") {
    input = { ...Object.fromEntries(new URL(request.url).searchParams), ...match.params };
  } else {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(400, { ok: false, error: "Тело запроса должно быть JSON-объектом" });
    }
    input = { ...(body as Record<string, unknown>), ...match.params };
  }

  // Idempotency-Key: повтор той же записи возвращает прежний ответ без дубля.
  const reply = await runIdempotent({
    store: prismaIdempotencyStore(db),
    key: request.method === "POST" ? restIdempotencyKey(ctx.keyId, match.tool.name, request.headers.get("idempotency-key")) : null,
    organizationId: ctx.orgId,
    run: async () => {
      const result = await runTool(match.tool, input, ctx);
      return result.ok
        ? { status: 200, body: JSON.parse(JSON.stringify({ ok: true, data: result.data })) }
        : { status: result.status, body: { ok: false, error: result.error } };
    },
  });
  const headers: Record<string, string> = {};
  if (reply.replayed) headers["idempotent-replayed"] = "true";
  if (reply.inFlight) headers["Retry-After"] = "2";
  return json(reply.status, reply.body, headers);
}

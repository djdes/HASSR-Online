import type { ApiCallContext } from "../context";
import { toolInputJsonSchema, type ApiTool, type ToolResult } from "../tools/types";
import { MCP_SERVER_INSTRUCTIONS } from "./instructions";
import {
  ALL_VERSIONS,
  DISCOVER_TTL_MS,
  LATEST_LEGACY_VERSION,
  LEGACY_VERSIONS,
  META_SERVER_INFO_KEY,
  META_VERSION_KEY,
  MODERN_VERSIONS,
  RPC,
  SERVER_INFO,
  TOOLS_LIST_TTL_MS,
} from "./protocol";

/**
 * Чистая обработка JSON-RPC тела MCP-запроса — без HTTP, ключей и базы.
 * Эпоху выбирает сам запрос: `_meta` с версией → 2026-07-28 (без
 * состояния), иначе — легаси с `initialize`.
 */

export type McpEnv = {
  headers: Headers;
  ctx: ApiCallContext;
  /** Весь реестр; tools/list сам отбирает доступные ключу. */
  tools: readonly ApiTool[];
  run: (tool: ApiTool, args: unknown, ctx: ApiCallContext) => Promise<ToolResult>;
};

/** `body === undefined` — пустой ответ (202 на уведомление). */
export type McpHttpReply = { status: number; body?: unknown };

type Json = Record<string, unknown>;
type RpcId = string | number | null;

function isObject(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function rpcError(id: RpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function rpcResult(id: RpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function idOf(message: Json): RpcId {
  const id = message.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function isNotification(message: Json): boolean {
  return !("id" in message) || message.id === undefined;
}

function metaVersion(message: unknown): string | null {
  if (!isObject(message) || !isObject(message.params) || !isObject(message.params._meta)) return null;
  const version = message.params._meta[META_VERSION_KEY];
  return typeof version === "string" ? version : null;
}

export function decodeHeaderValue(value: string): string {
  const match = /^=\?base64\?(.*)\?=$/.exec(value);
  return match ? Buffer.from(match[1], "base64").toString("utf8") : value;
}

function toolDefinition(tool: ApiTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: toolInputJsonSchema(tool),
    annotations: {
      title: tool.title,
      readOnlyHint: tool.access === "read",
      destructiveHint: false,
      idempotentHint: tool.access === "read" || tool.name === "fill_journal_cells",
      openWorldHint: false,
    },
  };
}

function listedTools(env: McpEnv) {
  return env.tools.filter((tool) => env.ctx.access === "write" || tool.access === "read").map(toolDefinition);
}

function discoverResult() {
  return {
    resultType: "complete",
    supportedVersions: ALL_VERSIONS,
    capabilities: { tools: { listChanged: false } },
    instructions: MCP_SERVER_INSTRUCTIONS,
    ttlMs: DISCOVER_TTL_MS,
    cacheScope: "private",
    _meta: { [META_SERVER_INFO_KEY]: SERVER_INFO },
  };
}

async function callTool(id: RpcId, params: unknown, env: McpEnv, modern: boolean): Promise<McpHttpReply> {
  if (!isObject(params) || typeof params.name !== "string") {
    return { status: 200, body: rpcError(id, RPC.invalidParams, "tools/call: params.name must be a string") };
  }
  const tool = env.tools.find((t) => t.name === params.name);
  if (!tool) {
    return { status: 200, body: rpcError(id, RPC.invalidParams, `Unknown tool: ${params.name}`) };
  }
  const result = await env.run(tool, params.arguments ?? {}, env.ctx);
  const payload = result.ok
    ? {
        content: [{ type: "text", text: (result.text ? `${result.text}\n\n` : "") + JSON.stringify(result.data, null, 2) }],
        structuredContent: result.data,
        isError: false,
      }
    : { content: [{ type: "text", text: result.error }], isError: true };
  return {
    status: 200,
    body: rpcResult(id, modern ? { resultType: "complete", ...payload, _meta: { [META_SERVER_INFO_KEY]: SERVER_INFO } } : payload),
  };
}

async function handleModern(message: Json, version: string, env: McpEnv): Promise<McpHttpReply> {
  const id = idOf(message);
  const headerVersion = env.headers.get("mcp-protocol-version");
  if (headerVersion !== version) {
    return {
      status: 400,
      body: rpcError(id, RPC.headerMismatch, `Header mismatch: MCP-Protocol-Version '${headerVersion ?? ""}' does not match _meta '${version}'`),
    };
  }
  if (!(MODERN_VERSIONS as readonly string[]).includes(version)) {
    return {
      status: 400,
      body: rpcError(id, RPC.unsupportedVersion, "Unsupported protocol version", { supported: ALL_VERSIONS, requested: version }),
    };
  }
  const method = message.method;
  if (typeof method !== "string") {
    return { status: 400, body: rpcError(id, RPC.invalidRequest, "method must be a string") };
  }
  if (env.headers.get("mcp-method") !== method) {
    return { status: 400, body: rpcError(id, RPC.headerMismatch, `Header mismatch: Mcp-Method does not match body method '${method}'`) };
  }
  const params = isObject(message.params) ? message.params : {};
  if (method === "tools/call") {
    const nameHeader = env.headers.get("mcp-name");
    if (nameHeader === null || decodeHeaderValue(nameHeader) !== params.name) {
      return { status: 400, body: rpcError(id, RPC.headerMismatch, "Header mismatch: Mcp-Name does not match params.name") };
    }
    return callTool(id, params, env, true);
  }
  if (method === "server/discover") return { status: 200, body: rpcResult(id, discoverResult()) };
  if (method === "tools/list") {
    return {
      status: 200,
      body: rpcResult(id, {
        resultType: "complete",
        tools: listedTools(env),
        ttlMs: TOOLS_LIST_TTL_MS,
        cacheScope: "private",
        _meta: { [META_SERVER_INFO_KEY]: SERVER_INFO },
      }),
    };
  }
  return { status: 404, body: rpcError(id, RPC.methodNotFound, `Method not found: ${method}`) };
}

function legacyHeaderProblem(env: McpEnv, id: RpcId): McpHttpReply | null {
  const headerVersion = env.headers.get("mcp-protocol-version");
  if (headerVersion === null) return null; // клиенты до 2025-06-18 заголовок не шлют
  if ((MODERN_VERSIONS as readonly string[]).includes(headerVersion)) {
    return {
      status: 400,
      body: rpcError(id, RPC.headerMismatch, `Header mismatch: MCP-Protocol-Version ${headerVersion} requires params._meta['${META_VERSION_KEY}']`),
    };
  }
  if (!ALL_VERSIONS.includes(headerVersion)) {
    return { status: 400, body: rpcError(id, RPC.invalidRequest, `Unsupported MCP-Protocol-Version: ${headerVersion}`) };
  }
  return null;
}

async function handleLegacyMessage(message: unknown, env: McpEnv): Promise<McpHttpReply> {
  if (!isObject(message)) return { status: 400, body: rpcError(null, RPC.invalidRequest, "Invalid JSON-RPC message") };
  if (isNotification(message)) return { status: 202 };
  const id = idOf(message);
  const method = message.method;
  if (typeof method !== "string") return { status: 400, body: rpcError(id, RPC.invalidRequest, "method must be a string") };

  switch (method) {
    case "initialize": {
      const requested = isObject(message.params) ? message.params.protocolVersion : undefined;
      const protocolVersion =
        typeof requested === "string" && (LEGACY_VERSIONS as readonly string[]).includes(requested) ? requested : LATEST_LEGACY_VERSION;
      return {
        status: 200,
        body: rpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: MCP_SERVER_INSTRUCTIONS,
        }),
      };
    }
    case "ping":
      return { status: 200, body: rpcResult(id, {}) };
    case "tools/list":
      return { status: 200, body: rpcResult(id, { tools: listedTools(env) }) };
    case "tools/call":
      return callTool(id, message.params, env, false);
    case "server/discover":
      return { status: 200, body: rpcResult(id, discoverResult()) };
    default:
      return { status: 200, body: rpcError(id, RPC.methodNotFound, `Method not found: ${method}`) };
  }
}

export async function handleMcpBody(body: unknown, env: McpEnv): Promise<McpHttpReply> {
  if (Array.isArray(body)) {
    // Пакеты были только в 2025-03-26; в 2026-07-28 — один запрос на POST.
    if (body.length === 0 || body.some((m) => metaVersion(m) !== null)) {
      return { status: 400, body: rpcError(null, RPC.invalidRequest, "Batch requests are not supported here") };
    }
    const headerProblem = legacyHeaderProblem(env, null);
    if (headerProblem) return headerProblem;
    const replies: unknown[] = [];
    for (const message of body) {
      const reply = await handleLegacyMessage(message, env);
      if (reply.body !== undefined) replies.push(reply.body);
    }
    return replies.length ? { status: 200, body: replies } : { status: 202 };
  }
  if (!isObject(body)) return { status: 400, body: rpcError(null, RPC.invalidRequest, "Invalid JSON-RPC message") };
  if (isNotification(body)) return { status: 202 };

  const version = metaVersion(body);
  if (version !== null) return handleModern(body, version, env);
  const headerProblem = legacyHeaderProblem(env, idOf(body));
  if (headerProblem) return headerProblem;
  return handleLegacyMessage(body, env);
}

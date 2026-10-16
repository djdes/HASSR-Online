import assert from "node:assert/strict";
import test from "node:test";
import type { ApiCallContext } from "../context";
import { PUBLIC_API_TOOLS } from "../tools";
import type { ApiTool, ToolResult } from "../tools/types";
import { handleMcpBody, type McpEnv } from "./handle-message";

const MODERN = "2026-07-28";
const META_KEY = "io.modelcontextprotocol/protocolVersion";

function ctx(access: "read" | "write" = "write"): ApiCallContext {
  return {
    keyId: "key1",
    keyName: "Ассистент",
    access,
    via: "mcp",
    orgId: "org1",
    orgName: "Кафе",
    timezone: "Europe/Moscow",
    actor: { id: "u1", role: "manager", isRoot: false, name: "Анна" },
    locale: "ru",
    baseUrl: "https://wesetup.ru",
  };
}

const calls: Array<{ tool: string; args: unknown }> = [];

function env(opts: { access?: "read" | "write"; headers?: Record<string, string> } = {}): McpEnv {
  return {
    headers: new Headers(opts.headers ?? {}),
    ctx: ctx(opts.access),
    tools: PUBLIC_API_TOOLS,
    run: async (tool: ApiTool, args: unknown, c: ApiCallContext): Promise<ToolResult> => {
      calls.push({ tool: tool.name, args });
      if (tool.access === "write" && c.access !== "write") {
        return { ok: false, status: 403, error: "Ключ только для чтения: создайте ключ «Чтение и запись»." };
      }
      return { ok: true, data: { echo: args, tool: tool.name }, text: "Готово" };
    },
  };
}

function modernHeaders(method: string, name?: string): Record<string, string> {
  return { "mcp-protocol-version": MODERN, "mcp-method": method, ...(name ? { "mcp-name": name } : {}) };
}

function modernRequest(method: string, params: Record<string, unknown> = {}, version = MODERN) {
  return { jsonrpc: "2.0", id: 7, method, params: { ...params, _meta: { [META_KEY]: version, "io.modelcontextprotocol/clientCapabilities": {} } } };
}

type Rpc = { id?: unknown; result?: Record<string, any>; error?: { code: number; message: string; data?: any } };
const rpc = (body: unknown) => body as Rpc;

test("легаси initialize 2025-06-18 → та же версия, capabilities.tools, serverInfo, instructions", async () => {
  const reply = await handleMcpBody(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    env()
  );
  assert.equal(reply.status, 200);
  const r = rpc(reply.body).result!;
  assert.equal(r.protocolVersion, "2025-06-18");
  assert.deepEqual(r.capabilities, { tools: { listChanged: false } });
  assert.equal(r.serverInfo.name, "wesetup");
  assert.ok(String(r.instructions).includes("get_context"));
  assert.equal("resultType" in r, false);
});

test("легаси initialize 2024-11-05 → protocolVersion 2025-11-25", async () => {
  const reply = await handleMcpBody({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }, env());
  assert.equal(rpc(reply.body).result!.protocolVersion, "2025-11-25");
});

test("notifications/initialized → 202 без тела", async () => {
  const reply = await handleMcpBody({ jsonrpc: "2.0", method: "notifications/initialized" }, env());
  assert.deepEqual(reply, { status: 202 });
});

test("легаси ping → result {}", async () => {
  const reply = await handleMcpBody({ jsonrpc: "2.0", id: "p", method: "ping" }, env());
  assert.deepEqual(rpc(reply.body), { jsonrpc: "2.0", id: "p", result: {} });
});

test("легаси tools/list ключом read → четыре инструмента чтения, у каждого inputSchema.type = object", async () => {
  const reply = await handleMcpBody({ jsonrpc: "2.0", id: 2, method: "tools/list" }, env({ access: "read" }));
  const tools = rpc(reply.body).result!.tools as Array<{ name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }>;
  assert.deepEqual(tools.map((t) => t.name), ["get_context", "list_journals", "get_journal_document", "list_employees"]);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.annotations.readOnlyHint, true);
  }
});

test("tools/call неизвестного инструмента → -32602", async () => {
  const reply = await handleMcpBody({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "drop_db", arguments: {} } }, env());
  assert.equal(rpc(reply.body).error!.code, -32602);
});

test("tools/call add_employee ключом read → isError с текстом про чтение", async () => {
  const reply = await handleMcpBody(
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "add_employee", arguments: { fullName: "Иван Петров", jobPositionId: "p1" } } },
    env({ access: "read" })
  );
  const r = rpc(reply.body).result!;
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /только для чтения/);
});

test("tools/call ok → текст с JSON, structuredContent = data, isError = false", async () => {
  const reply = await handleMcpBody({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_context" } }, env());
  const r = rpc(reply.body).result!;
  assert.equal(r.isError, false);
  assert.deepEqual(r.structuredContent, { echo: {}, tool: "get_context" });
  assert.ok(r.content[0].text.startsWith("Готово\n\n{"));
  assert.ok(r.content[0].text.includes('"tool": "get_context"'));
});

test("современный tools/list → resultType, ttlMs, cacheScope private, serverInfo в _meta", async () => {
  const reply = await handleMcpBody(modernRequest("tools/list"), env({ headers: modernHeaders("tools/list") }));
  assert.equal(reply.status, 200);
  const r = rpc(reply.body).result!;
  assert.equal(r.resultType, "complete");
  assert.equal(r.ttlMs, 300000);
  assert.equal(r.cacheScope, "private");
  assert.equal(r._meta["io.modelcontextprotocol/serverInfo"].name, "wesetup");
  assert.equal(r.tools.length, 6);
});

test("современный server/discover → все поддерживаемые версии", async () => {
  const reply = await handleMcpBody(modernRequest("server/discover"), env({ headers: modernHeaders("server/discover") }));
  const r = rpc(reply.body).result!;
  assert.deepEqual(r.supportedVersions, ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"]);
  assert.deepEqual(r.capabilities, { tools: { listChanged: false } });
  assert.equal(r.resultType, "complete");
});

test("современный без заголовка MCP-Protocol-Version → 400, -32020", async () => {
  const reply = await handleMcpBody(modernRequest("tools/list"), env({ headers: { "mcp-method": "tools/list" } }));
  assert.equal(reply.status, 400);
  assert.equal(rpc(reply.body).error!.code, -32020);
});

test("современный: Mcp-Method не совпадает → 400, -32020", async () => {
  const reply = await handleMcpBody(modernRequest("tools/list"), env({ headers: modernHeaders("tools/call") }));
  assert.equal(reply.status, 400);
  assert.equal(rpc(reply.body).error!.code, -32020);
});

test("современный tools/call: Mcp-Name в base64-обёртке совпадает → ok; другое имя → 400, -32020", async () => {
  const ok = await handleMcpBody(
    modernRequest("tools/call", { name: "get_context", arguments: {} }),
    env({ headers: modernHeaders("tools/call", "=?base64?Z2V0X2NvbnRleHQ=?=") })
  );
  assert.equal(ok.status, 200);
  assert.equal(rpc(ok.body).result!.resultType, "complete");
  const bad = await handleMcpBody(
    modernRequest("tools/call", { name: "get_context", arguments: {} }),
    env({ headers: modernHeaders("tools/call", "other") })
  );
  assert.equal(bad.status, 400);
  assert.equal(rpc(bad.body).error!.code, -32020);
});

test("современный с версией 1900-01-01 → 400, -32022, supported и requested", async () => {
  const reply = await handleMcpBody(
    modernRequest("tools/list", {}, "1900-01-01"),
    env({ headers: { "mcp-protocol-version": "1900-01-01", "mcp-method": "tools/list" } })
  );
  assert.equal(reply.status, 400);
  const e = rpc(reply.body).error!;
  assert.equal(e.code, -32022);
  assert.equal(e.data.requested, "1900-01-01");
  assert.ok(e.data.supported.includes("2026-07-28"));
});

test("современный неизвестный метод → 404, -32601", async () => {
  const reply = await handleMcpBody(modernRequest("resources/list"), env({ headers: modernHeaders("resources/list") }));
  assert.equal(reply.status, 404);
  assert.equal(rpc(reply.body).error!.code, -32601);
});

test("легаси с заголовком MCP-Protocol-Version: 1999-01-01 → 400", async () => {
  const reply = await handleMcpBody({ jsonrpc: "2.0", id: 1, method: "tools/list" }, env({ headers: { "mcp-protocol-version": "1999-01-01" } }));
  assert.equal(reply.status, 400);
});

test("пакет: два легаси-запроса и уведомление → массив из двух ответов с теми же id", async () => {
  const reply = await handleMcpBody(
    [
      { jsonrpc: "2.0", id: "a", method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: "b", method: "tools/list" },
    ],
    env()
  );
  assert.equal(reply.status, 200);
  const list = reply.body as Rpc[];
  assert.deepEqual(list.map((r) => r.id), ["a", "b"]);
});

test("тело 42 → 400, -32600", async () => {
  const reply = await handleMcpBody(42, env());
  assert.equal(reply.status, 400);
  assert.equal(rpc(reply.body).error!.code, -32600);
});

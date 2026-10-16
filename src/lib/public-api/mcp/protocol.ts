/**
 * Константы MCP. Сервер «двух эпох»:
 * - 2026-07-28 — без состояния: версия и возможности клиента в `_meta`
 *   каждого запроса, `server/discover`, заголовки MCP-Protocol-Version /
 *   Mcp-Method / Mcp-Name, `resultType` в результатах;
 * - 2025-03-26…2025-11-25 — рукопожатие `initialize`.
 * https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
 */

export const MODERN_VERSIONS = ["2026-07-28"] as const;
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const ALL_VERSIONS: string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
export const LATEST_LEGACY_VERSION = "2025-11-25";

export const META_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
export const META_SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";

export const SERVER_INFO = { name: "wesetup", title: "WeSetup", version: "1.0.0" };

export const RPC = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  unauthorized: -32000,
  headerMismatch: -32020,
  unsupportedVersion: -32022,
} as const;

export const TOOLS_LIST_TTL_MS = 300_000;
export const DISCOVER_TTL_MS = 3_600_000;

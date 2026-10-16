import { handleMcpHttp, mcpMethodNotAllowed, mcpPreflight } from "@/lib/public-api/mcp/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MCP-сервер WeSetup для ИИ-ассистентов (Claude, ChatGPT, Cursor).
 * Ключ — в заголовке `Authorization: Bearer wsk_…`; вариант с ключом в
 * адресе — /api/mcp/[key]. Настройка — /settings/api.
 */
export async function POST(request: Request) {
  return handleMcpHttp(request);
}

export async function OPTIONS(request: Request) {
  return mcpPreflight(request);
}

export async function GET() {
  return mcpMethodNotAllowed();
}

export async function DELETE() {
  return mcpMethodNotAllowed();
}

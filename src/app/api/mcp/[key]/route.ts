import { handleMcpHttp, mcpMethodNotAllowed, mcpPreflight } from "@/lib/public-api/mcp/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Тот же MCP-сервер с ключом в адресе — для коннекторов claude.ai и
 * ChatGPT, которые без OAuth не умеют передавать заголовок. Ссылка с
 * ключом равна паролю: страница /settings/api так и предупреждает.
 */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return handleMcpHttp(request, { pathKey: key });
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

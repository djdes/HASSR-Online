import { handleRestRequest } from "@/lib/public-api/rest/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path?: string[] }> };

/** REST API v1 WeSetup. Описание — /api/v1/openapi.json, ключ — /settings/api. */
export async function GET(request: Request, { params }: Params) {
  const { path } = await params;
  return handleRestRequest(request, path ?? []);
}

export async function POST(request: Request, { params }: Params) {
  const { path } = await params;
  return handleRestRequest(request, path ?? []);
}

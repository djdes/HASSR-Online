import { NextResponse } from "next/server";
import { readBuildingIconFile } from "@/lib/building-icon-file.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Свой значок объекта: `/api/org-assets/<org>/building-icon/<id>?v=<n>`.
 * Как логотип организации: без авторизации (значок не секрет, адрес с
 * версией кэшируется), SVG — с `sandbox`-CSP и nosniff, чтобы браузер
 * открыл его только как картинку. Объект другой организации — 404.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ organizationId: string; buildingId: string }> },
) {
  const { organizationId, buildingId } = await ctx.params;
  const file = await readBuildingIconFile(organizationId, buildingId);
  if (!file) return new NextResponse(null, { status: 404 });

  const body = new Uint8Array(file.bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      "Content-Disposition": "inline",
    },
  });
}

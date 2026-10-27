import { NextResponse } from "next/server";
import { readOrgQrIcon } from "@/lib/org-qr-icon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Публичная раздача значка QR организации: `/api/org-assets/<id>/icon?v=<n>`.
 * Без авторизации — значок не секрет, а адрес с версией кэшируется.
 * SVG — с `sandbox`-CSP и nosniff, как у логотипа партнёра: даже если
 * очистка что-то пропустила, браузер откроет его только как картинку.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await ctx.params;
  const icon = await readOrgQrIcon(organizationId);
  if (!icon) return new NextResponse(null, { status: 404 });

  const body = new Uint8Array(icon.bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": icon.mime,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      "Content-Disposition": "inline",
    },
  });
}

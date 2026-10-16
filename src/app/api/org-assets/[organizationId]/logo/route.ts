import { NextResponse } from "next/server";
import { readOrgLogo } from "@/lib/org-logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Публичная раздача логотипа организации: `/api/org-assets/<id>/logo?v=<n>`.
 * Без авторизации — логотип не секрет, а адрес с версией кэшируется.
 * SVG — с `sandbox`-CSP и nosniff, как у логотипа партнёра: даже если
 * очистка что-то пропустила, браузер откроет его только как картинку.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await ctx.params;
  const logo = await readOrgLogo(organizationId);
  if (!logo) return new NextResponse(null, { status: 404 });

  const body = new Uint8Array(logo.bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      "Content-Disposition": "inline",
    },
  });
}

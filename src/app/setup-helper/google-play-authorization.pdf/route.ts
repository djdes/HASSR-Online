import { NextResponse } from "next/server";

import { renderGooglePlayAuthorizationPdf } from "@/lib/setup-helper-play-authorization";
import { loadBfsAuthorizationAssets } from "@/lib/setup-helper-play-authorization.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { seller, images } = await loadBfsAuthorizationAssets();
  const pdf = renderGooglePlayAuthorizationPdf(images, seller);

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        'inline; filename="bfs-google-play-authorization-app.wedo4u.setuphelper.pdf"',
      "Content-Length": String(pdf.length),
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

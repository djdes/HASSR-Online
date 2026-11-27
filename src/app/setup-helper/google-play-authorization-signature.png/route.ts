import { NextResponse } from "next/server";

import { renderGooglePlaySignatureCardPng } from "@/lib/setup-helper-play-authorization";
import { loadBfsAuthorizationAssets } from "@/lib/setup-helper-play-authorization.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { images } = await loadBfsAuthorizationAssets();
  const png = await renderGooglePlaySignatureCardPng(images);

  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.length),
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

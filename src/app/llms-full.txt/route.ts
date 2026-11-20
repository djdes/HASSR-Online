import { NextResponse } from "next/server";

import { renderLlmsFullTxt } from "@/lib/promo-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const body = await renderLlmsFullTxt();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Content-Signal": "search=yes, ai-input=yes, ai-train=no",
    },
  });
}

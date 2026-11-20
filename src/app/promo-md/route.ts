import { NextResponse } from "next/server";

import { renderPromoMarkdown } from "@/lib/promo-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const target = url.searchParams.get("target") ?? "";
  const via = url.searchParams.get("via") ?? "ext";

  if (!target.startsWith("/")) {
    return new NextResponse("Not Found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const rendered = await renderPromoMarkdown(target);
  if (!rendered) {
    return new NextResponse("Not Found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Language": rendered.locale === "uz" ? "uz-Latn" : rendered.locale,
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    Vary: "Accept",
    Link: `<${rendered.canonicalUrl}>; rel="canonical"`,
    "Content-Signal": "search=yes, ai-input=yes, ai-train=no",
  };
  if (via === "ext") {
    headers["X-Robots-Tag"] = "noindex, follow";
  }

  return new NextResponse(rendered.markdown, { status: 200, headers });
}

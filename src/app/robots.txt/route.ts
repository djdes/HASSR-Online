import { NextResponse } from "next/server";

import { renderRobotsTxt } from "@/lib/robots-txt";

export const dynamic = "force-static";
export const revalidate = 3600;

export function GET() {
  return new NextResponse(renderRobotsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { SearchQueriesConfigError, explanationLines } from "@/lib/seo/search-queries.server";

import { getCachedReport, parseReportParams } from "./report.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/root/seo/queries?from=2026-08-25&to=2026-11-24&range=gsc[&refresh=1]
 *
 * Запросы Google (Search Console + поведение из Метрики по странице входа)
 * и поисковые фразы Яндекса. Ключи остаются на сервере.
 */
export async function GET(request: Request) {
  await requireRoot();
  const url = new URL(request.url);
  const params = parseReportParams(url);
  if (typeof params === "string") return NextResponse.json({ error: params }, { status: 400 });
  try {
    const report = await getCachedReport(params, url.searchParams.get("refresh") === "1");
    return NextResponse.json({ configured: true, report, explanations: explanationLines(report) });
  } catch (error) {
    if (error instanceof SearchQueriesConfigError) {
      return NextResponse.json({ configured: false, error: error.message });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

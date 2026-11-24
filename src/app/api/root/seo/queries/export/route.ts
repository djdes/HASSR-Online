import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { buildSearchQueriesWorkbook } from "@/lib/seo/search-queries.server";

import { getCachedReport, parseReportParams } from "../report.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/root/seo/queries/export?from&to&range — тот же отчёт файлом Excel (как `npm run seo:export`). */
export async function GET(request: Request) {
  await requireRoot();
  const params = parseReportParams(new URL(request.url));
  if (typeof params === "string") return NextResponse.json({ error: params }, { status: 400 });
  try {
    const report = await getCachedReport(params);
    const buffer = await buildSearchQueriesWorkbook(report).xlsx.writeBuffer();
    const name = `seo-queries-${params.from}-${params.to}.xlsx`;
    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}

import { NextResponse } from "next/server";

import sitemap from "@/app/sitemap";
import { requireRoot } from "@/lib/auth-helpers";
import { runSeoHealth, seoHealthStatus } from "@/lib/seo/crawl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET — последний отчёт (или null) и статус текущего обхода; POST — обойти заново. */
export async function GET() {
  await requireRoot();
  return NextResponse.json(seoHealthStatus());
}

export async function POST() {
  await requireRoot();
  const entries = await sitemap();
  const urls = entries.map((e) => e.url);
  const report = await runSeoHealth(urls, { force: true });
  return NextResponse.json({ report, running: false, progress: null });
}


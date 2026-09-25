import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { computeNpsReport, normalizeNpsScale } from "@/lib/nps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — NPS за 90 дней и за всё время, последние ответы с комментариями.
 * `last90` / `allTime` — общий NPS по обеим шкалам (1–5 и старой 0–10),
 * `byScale` — отдельно по каждой шкале с распределением оценок.
 */
export async function GET() {
  await requireRoot();
  const since = new Date(Date.now() - 90 * 86_400_000);
  const [recent, all, latest] = await Promise.all([
    db.npsResponse.findMany({ where: { createdAt: { gte: since } }, select: { score: true, scale: true } }),
    db.npsResponse.findMany({ select: { score: true, scale: true } }),
    db.npsResponse.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, score: true, scale: true, comment: true, createdAt: true, organizationId: true, userId: true } }),
  ]);
  const orgIds = Array.from(new Set(latest.map((r) => r.organizationId)));
  const orgs = orgIds.length ? await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const last90 = computeNpsReport(recent);
  const allTime = computeNpsReport(all);
  return NextResponse.json({
    last90: last90.overall,
    allTime: allTime.overall,
    byScale: {
      last90: { scale5: last90.scale5, scale10: last90.scale10 },
      allTime: { scale5: allTime.scale5, scale10: allTime.scale10 },
    },
    latest: latest.map((r) => ({ ...r, scale: normalizeNpsScale(r.scale), createdAt: r.createdAt.toISOString(), organization: orgName.get(r.organizationId) ?? r.organizationId })),
  });
}

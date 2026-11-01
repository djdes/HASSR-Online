import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { getViewedPointId } from "@/lib/active-building";
import { areaPointWhere, lossPointWhere } from "@/lib/point-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * L5 — Autocomplete продуктов для записи потерь. Возвращает топ-20
 * последних productName из этой org за последние 90 дней. Снижает
 * количество опечаток («Молоко» / «молоко» / «малоко»).
 *
 * GET /api/losses/product-suggest?q=мол → { suggestions: ["Молоко 3.2%", ...] }
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const orgId = getActiveOrgId(auth.session);

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // Подсказки — из потерь точки в шапке, как список потерь (2026-11-01,
  // «точка видит только своё»): раньше — из потерь всех точек.
  const pointId = await getViewedPointId(auth.session);
  const pointAreas = pointId
    ? await db.area.findMany({ where: { organizationId: orgId, ...areaPointWhere(pointId) }, select: { id: true } })
    : [];

  const records = await db.lossRecord.findMany({
    where: {
      organizationId: orgId,
      date: { gte: since },
      ...(q ? { productName: { contains: q, mode: "insensitive" } } : {}),
      ...lossPointWhere(pointId, pointAreas.map((area) => area.id)),
    },
    select: { productName: true },
    orderBy: { date: "desc" },
    take: 200,
  });

  // Распределим по частоте.
  const counts = new Map<string, number>();
  for (const r of records) {
    if (!r.productName) continue;
    counts.set(r.productName, (counts.get(r.productName) ?? 0) + 1);
  }

  const suggestions = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name]) => name);

  return NextResponse.json({ suggestions });
}

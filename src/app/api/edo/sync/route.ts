import { NextResponse } from "next/server";

import { guardSupply } from "@/lib/supply/guard.server";
import { syncOrganizationSupply } from "@/lib/supply/sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Не чаще: при открытии входящих — раз в 15 минут, кнопкой — сразу. */
const STALE_MS = 15 * 60 * 1000;

/**
 * POST /api/edo/sync — забрать новые УПД из подключённых Диадока и СБИС и
 * данные iiko (накладные, списания, товары).
 * `?ifStale=1` — только подключения, которые не проверялись 15 минут.
 */
export async function POST(request: Request) {
  const { organizationId, denied } = await guardSupply();
  if (denied) return denied;
  const ifStale = new URL(request.url).searchParams.get("ifStale") === "1";
  const results = await syncOrganizationSupply(organizationId, { minIntervalMs: ifStale ? STALE_MS : 0 });
  return NextResponse.json({
    created: results.reduce((sum, result) => sum + result.created, 0),
    results: results.map((result) => ({
      provider: result.provider,
      ok: result.ok,
      error: result.error,
      created: result.created,
      ...(result.provider === "iiko" ? { losses: result.losses ?? 0, products: result.products ?? 0 } : {}),
    })),
  });
}

import { NextResponse } from "next/server";

import { createRateLimiter } from "@/lib/rate-limit";
import { authenticateHelperDevice } from "@/lib/setup-helper-auth";
import { loadHelperBranding } from "@/lib/setup-helper-branding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ tokensPerInterval: 30, intervalMs: 60 * 1000 });

/**
 * GET /api/setup-helper/branding — фирменная шапка этикеток организации:
 * название, сайт и логотип, готовый к печати (1 бит, дизеринг).
 *
 * `Authorization: Bearer <ключ телефона>`, как у остальных методов.
 * Организацию берём из ключа. Приложение хранит копию и скачивает заново,
 * когда меняется `version`.
 */
export async function GET(request: Request) {
  const device = await authenticateHelperDevice(request);
  if (!device) {
    return NextResponse.json(
      { error: "Приложение отключено от аккаунта — войдите заново", code: "device_revoked" },
      { status: 401 },
    );
  }
  if (!limiter.consume(device.id)) {
    return NextResponse.json({ error: "Слишком частые запросы. Повторим позже." }, { status: 429 });
  }
  const branding = await loadHelperBranding(device.organizationId);
  return NextResponse.json(branding, { headers: { "Cache-Control": "no-store" } });
}

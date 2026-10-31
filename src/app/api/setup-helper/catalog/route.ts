import { NextResponse } from "next/server";

import { createRateLimiter } from "@/lib/rate-limit";
import { authenticateHelperDevice } from "@/lib/setup-helper-auth";
import { loadHelperCatalog } from "@/lib/setup-helper-catalog.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ tokensPerInterval: 30, intervalMs: 60 * 1000 });

/**
 * GET /api/setup-helper/catalog — справочники для полей этикеток: продукты
 * (срок годности, условия хранения), блюда, поставщики, сотрудники.
 *
 * `Authorization: Bearer <ключ телефона>`; организация — из ключа.
 * `?version=<версия копии на телефоне>`: не изменилось — `{ version,
 * unchanged: true }` без справочников, телефон оставляет свою копию.
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
  // Сотрудник точки получает справочники своей точки (см. loadHelperCatalog).
  const catalog = await loadHelperCatalog(device.organizationId, new Date(), { userId: device.userId });
  const known = new URL(request.url).searchParams.get("version");
  const body = known && known === catalog.version ? { version: catalog.version, unchanged: true } : catalog;
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

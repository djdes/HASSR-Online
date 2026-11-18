import { NextResponse } from "next/server";

import { clientIp } from "@/lib/client-ip";
import { lookupIpGeo } from "@/lib/ip-geo";

export const runtime = "nodejs";

/**
 * GET /api/public/geo-hint — город посетителя по IP, чтобы форма регистрации
 * подставила его сама (спека conversion-pack-2026-11): на одно поле меньше.
 * Только подсказка: человек видит город в поле и может поменять. Ничего не
 * сохраняет, ответ не кешируется.
 */
export async function GET(request: Request) {
  const geo = await lookupIpGeo(clientIp(request), { headers: request.headers, timeoutMs: 1200 }).catch(() => null);
  return NextResponse.json(geo?.city ? { city: geo.city, countryCode: geo.countryCode } : {}, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

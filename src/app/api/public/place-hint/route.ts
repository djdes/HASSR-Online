import { NextResponse } from "next/server";

import { clientIp } from "@/lib/client-ip";
import { findGeoPlace } from "@/lib/geo-places";
import { lookupIpGeo } from "@/lib/ip-geo";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Подсказка поля «Город» (регистрация, настройки): город и страна по IP
 * (спека tg-client-location-2026-11). Город из каталога — с его поясом.
 * Ничего не знаем или лимит — `{ place: null }`: поле остаётся с городом
 * по поясу браузера.
 */
const limiter = createRateLimiter({ tokensPerInterval: 20, intervalMs: 60_000 });

export async function GET(request: Request) {
  const ip = clientIp(request);
  if (!ip || !limiter.consume(`place-hint:${ip}`)) return NextResponse.json({ place: null });
  const geo = await lookupIpGeo(ip, { headers: request.headers }).catch(() => null);
  if (!geo) return NextResponse.json({ place: null });
  const known = geo.city ? findGeoPlace(geo.city, geo.countryCode) : null;
  return NextResponse.json(
    {
      place: known ?? { city: geo.city, countryCode: geo.countryCode, timeZone: geo.timeZone },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

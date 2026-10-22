import { clientIp } from "@/lib/client-ip";
import { parseCountdownParams } from "@/lib/mailing/countdown";
import { renderCountdownGif } from "@/lib/mailing/countdown-gif.server";
import { createRateLimiter } from "@/lib/rate-limit";

// Публичная картинка для писем: без сессии, рисуется в момент открытия письма.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; gif: Buffer }>();

// Рисование — 60 кадров, поэтому новые отрисовки ограничены: перебором `until`
// кэш не обойти. Обычная рассылка в лимит не упирается — у получателей одна
// дата окончания, и открытия в ту же секунду берут кадры из кэша.
const renderPerIp = createRateLimiter({ tokensPerInterval: 30, intervalMs: 60_000 });
const renderTotal = createRateLimiter({ tokensPerInterval: 120, intervalMs: 60_000 });

export async function GET(request: Request) {
  const now = new Date();
  const parsed = parseCountdownParams(new URL(request.url).searchParams, now);
  if (!parsed.ok) {
    return new Response(parsed.error, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const key = `${parsed.until.toISOString()}|${parsed.theme}|${Math.floor(now.getTime() / 1000)}`;
  let hit = cache.get(key);
  if (!hit || now.getTime() - hit.at > CACHE_TTL_MS) {
    const ip = clientIp(request) ?? "unknown";
    if (!renderPerIp.consume(ip) || !renderTotal.consume("all")) {
      return new Response("Too many requests", {
        status: 429,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "60" },
      });
    }
    for (const [k, v] of cache) {
      if (now.getTime() - v.at > CACHE_TTL_MS) cache.delete(k);
    }
    while (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    hit = { at: now.getTime(), gif: renderCountdownGif(parsed.until, parsed.theme, now) };
    cache.set(key, hit);
  }

  return new Response(new Uint8Array(hit.gif), {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "public, max-age=30",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

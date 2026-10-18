import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";
import { createPageNavigationLimiter, hasAutomationUserAgent } from "./page-navigation-limit";

import { publicLocaleRoute } from "@/i18n/site-locale";

const limiter = createPageNavigationLimiter();
const EXCLUDED = ["/api", "/_next", "/.well-known", "/og", "/og-default", "/payment", "/invite", "/equipment-fill", "/room-fill", "/task-fill", "/kiosk"];
const ASSET = /\.(?:css|js|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|pdf|mp4|webm|mp3|wav|txt|xml|webmanifest)$/i;
const PUBLIC_ASSETS = ["/brand/", "/icons/", "/journal-samples/", "/landing/", "/uploads/"];

function canonicalIp(value: string | null): string | null {
  if (!value || value.length > 64) return null;
  const ip = value.trim();
  const family = isIP(ip);
  if (!family || ip.includes("%")) return null;
  return family === 6 ? new URL(`http://[${ip}]`).hostname : ip;
}

/**
 * Client IP as set by our ingress. Requires an ingress that overwrites
 * X-Real-IP and a non-public origin port. Never use the first XFF entry:
 * clients may prepend it. Nginx appends its peer.
 */
export function trustedClientIp(headers: { get(name: string): string | null }): string | null {
  return canonicalIp(headers.get("x-real-ip")) ??
    canonicalIp(headers.get("x-forwarded-for")?.split(",").at(-1) ?? null);
}

/** Requires an ingress that overwrites X-Real-IP and a non-public origin port. */
export function pageNavigationSubject(headers: Headers, verifiedUserId?: unknown): string {
  if (typeof verifiedUserId === "string" && verifiedUserId.length > 0 && verifiedUserId.length <= 256) {
    return `user:${verifiedUserId}`;
  }
  return `ip:${trustedClientIp(headers) ?? "unknown"}`;
}

export function isLimitedPageRequest(req: NextRequest): boolean {
  const path = req.nextUrl.pathname;
  const staticAsset = ASSET.test(path) &&
    (path.lastIndexOf("/") === 0 || PUBLIC_ASSETS.some((prefix) => path.startsWith(prefix)));
  return req.method === "GET" && !staticAsset &&
    !EXCLUDED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function waitHtml(seconds: number, en = false): string {
  return `<!doctype html><html lang="${en ? "en" : "ru"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${en ? "A short pause — WeSetup" : "Небольшая пауза — WeSetup"}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#fafbff;color:#1d2340;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:100%;max-width:480px;background:#fff;border:1px solid #ececf4;border-radius:24px;padding:36px;box-shadow:0 16px 48px #242d6010}.brand{font-weight:750;letter-spacing:-.5px;font-size:20px;margin:0 0 32px;color:#5566f6}.icon{width:48px;height:48px;padding:12px;border-radius:16px;background:#eef0ff;color:#5566f6}h1{font-size:28px;line-height:1.2;letter-spacing:-.7px;margin:20px 0 12px}p{font-size:15px;line-height:1.6;color:#626982}.time{font-size:44px;font-weight:700;color:#1d2340;font-variant-numeric:tabular-nums;margin:24px 0 4px}.hint{margin:0 0 24px;min-height:48px}button{width:100%;border:0;border-radius:14px;background:#5566f6;color:#fff;padding:14px 16px;font:600 15px system-ui;cursor:pointer}button:disabled{background:#e9ecfc;color:#636b91;cursor:wait}button:focus-visible{outline:3px solid #5566f6;outline-offset:4px}#reload-help{margin-bottom:0}@media(max-width:380px){body{padding:16px}main{padding:24px}h1{font-size:25px}}</style></head>
<body><main><p class="brand">WeSetup</p><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><h1>${en ? "Too many page requests" : "Слишком много переходов"}</h1><p>${en ? "Pages were opened too frequently. Please wait a moment before continuing." : "Страницы открывались слишком часто. Подождите немного, чтобы продолжить работу."}</p><p class="time" role="timer" aria-label="${en ? "Seconds remaining" : "Осталось секунд"}"><span id="seconds">${seconds}</span> <small>${en ? "sec." : "сек."}</small></p><p id="hint" class="hint" aria-live="polite">${en ? "You can reopen this page after the pause." : "После паузы можно снова открыть эту страницу."}</p><button id="retry" type="button" disabled>${en ? "Continue" : "Продолжить"}</button><p id="reload-help">${en ? `If the timer is not changing, wait ${seconds} seconds and refresh this page.` : `Если отсчёт не меняется, подождите ${seconds} сек. и обновите страницу в браузере.`}</p></main>
<script>(()=>{const end=Date.now()+${seconds}*1000;const count=document.getElementById('seconds');const button=document.getElementById('retry');const tick=()=>{const left=Math.max(0,Math.ceil((end-Date.now())/1000));count.textContent=String(left);if(!left){button.disabled=false;document.getElementById('hint').textContent=${JSON.stringify(en ? "The pause has ended. You can continue." : "Пауза закончилась. Можно продолжить.")};clearInterval(timer)}};const timer=setInterval(tick,250);button.addEventListener('click',()=>window.location.reload());tick();document.getElementById('reload-help').hidden=true})()</script></body></html>`;
}

/** Called only after the proxy's existing authorization decisions. */
export function pageNavigationGuard(req: NextRequest, verifiedUserId?: unknown): NextResponse | null {
  if (!isLimitedPageRequest(req)) return null;
  // Next 16 strips Flight headers before proxy and full prefetch has no marker.
  // Browser fetch metadata survives. Both real and forged fetches stay bounded;
  // clients without fetch metadata receive the stricter document budget.
  const background = req.headers.get("sec-fetch-dest") === "empty" || req.headers.get("rsc") === "1";
  const retryAfter = limiter.check(pageNavigationSubject(req.headers, verifiedUserId), hasAutomationUserAgent(req.headers.get("user-agent")), background);
  if (!retryAfter) return null;
  return new NextResponse(waitHtml(retryAfter, publicLocaleRoute(req.nextUrl.pathname)?.locale === "en"), {
    status: 429,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      "Retry-After": String(retryAfter),
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

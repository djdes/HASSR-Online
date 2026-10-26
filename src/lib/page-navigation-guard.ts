import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";
import { recordPageLimit, platformOf, sectionOf, type PageLimitClient, type PageLimitSubject } from "./page-limit-stats";
import { createPageNavigationLimiter, hasAutomationUserAgent, PAGE_NAVIGATION_LIMITS, pageLimitMode, type PageLimitDecision } from "./page-navigation-limit";
import { issueVisitorToken, verifiedVisitorId, VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE } from "./page-visitor";
import { claimedCrawler, createCrawlerVerifier } from "./verified-crawler";

import { publicLocaleRoute } from "@/i18n/site-locale";
import { isMobileAppUserAgent } from "@/lib/mobile-app";

const limiter = createPageNavigationLimiter();
// Guests with a signed cookie: a table of its own, so minted cookies can never
// crowd addresses and accounts out of the main one. Full — counted by address.
const visitors = createPageNavigationLimiter(Date.now, 20_000);
const crawlers = createCrawlerVerifier();
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

function verifiedUser(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;
}

/** Requires an ingress that overwrites X-Real-IP and a non-public origin port. */
export function pageNavigationSubject(headers: { get(name: string): string | null }, verifiedUserId?: unknown): string {
  const userId = verifiedUser(verifiedUserId);
  return userId ? `user:${userId}` : `ip:${trustedClientIp(headers) ?? "unknown"}`;
}

export function isLimitedPageRequest(req: NextRequest): boolean {
  const path = req.nextUrl.pathname;
  const staticAsset = ASSET.test(path) &&
    (path.lastIndexOf("/") === 0 || PUBLIC_ASSETS.some((prefix) => path.startsWith(prefix)));
  return req.method === "GET" && !staticAsset &&
    !EXCLUDED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function waitHtml(seconds: number, en = false): string {
  const text = en
    ? { done: "The pause has ended. You can continue.", auto: "The page will open by itself when the pause ends.", opening: "The pause has ended — opening the page…" }
    : { done: "Пауза закончилась. Можно продолжить.", auto: "Страница откроется сама, когда пауза закончится.", opening: "Пауза закончилась — открываем страницу…" };
  return `<!doctype html><html lang="${en ? "en" : "ru"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${en ? "A short pause — WeSetup" : "Небольшая пауза — WeSetup"}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#fafbff;color:#1d2340;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:100%;max-width:480px;background:#fff;border:1px solid #ececf4;border-radius:24px;padding:36px;box-shadow:0 16px 48px #242d6010}.brand{font-weight:750;letter-spacing:-.5px;font-size:20px;margin:0 0 32px;color:#5566f6}.icon{width:48px;height:48px;padding:12px;border-radius:16px;background:#eef0ff;color:#5566f6}h1{font-size:28px;line-height:1.2;letter-spacing:-.7px;margin:20px 0 12px}p{font-size:15px;line-height:1.6;color:#626982}.time{font-size:44px;font-weight:700;color:#1d2340;font-variant-numeric:tabular-nums;margin:24px 0 4px}.hint{margin:0 0 24px;min-height:48px}button{width:100%;border:0;border-radius:14px;background:#5566f6;color:#fff;padding:14px 16px;font:600 15px system-ui;cursor:pointer}button:disabled{background:#e9ecfc;color:#636b91;cursor:wait}button:focus-visible{outline:3px solid #5566f6;outline-offset:4px}#reload-help{margin-bottom:0}@media(max-width:380px){body{padding:16px}main{padding:24px}h1{font-size:25px}}</style></head>
<body><main><p class="brand">WeSetup</p><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><h1>${en ? "Too many page requests" : "Слишком много переходов"}</h1><p>${en ? "Pages were opened too frequently. Please wait a moment before continuing." : "Страницы открывались слишком часто. Подождите немного, чтобы продолжить работу."}</p><p class="time" role="timer" aria-label="${en ? "Seconds remaining" : "Осталось секунд"}"><span id="seconds">${seconds}</span> <small>${en ? "sec." : "сек."}</small></p><p id="hint" class="hint" aria-live="polite">${en ? "You can reopen this page after the pause." : "После паузы можно снова открыть эту страницу."}</p><button id="retry" type="button" disabled>${en ? "Continue" : "Продолжить"}</button><p id="reload-help">${en ? `If the timer is not changing, wait ${seconds} seconds and refresh this page.` : `Если отсчёт не меняется, подождите ${seconds} сек. и обновите страницу в браузере.`}</p></main>
<script>(()=>{const start=Date.now(),end=start+${seconds}*1000,autoAt=start+Math.max(${seconds},3)*1000,key='wesetup:page-wait';const count=document.getElementById('seconds'),button=document.getElementById('retry'),hint=document.getElementById('hint');
const last=()=>{const v=JSON.parse(sessionStorage.getItem(key)||'null');return v&&Date.now()-v.at<120000?v.n:0};
let auto=false;try{auto=last()<3}catch(e){}
const go=(byHand)=>{try{sessionStorage.setItem(key,JSON.stringify({n:byHand?0:last()+1,at:Date.now()}))}catch(e){}window.location.reload()};
if(auto)hint.textContent=${JSON.stringify(text.auto)};let done=false;
const tick=()=>{const left=Math.max(0,Math.ceil((end-Date.now())/1000));count.textContent=String(left);if(!left&&!done){done=true;button.disabled=false;hint.textContent=auto?${JSON.stringify(text.opening)}:${JSON.stringify(text.done)};if(!auto)clearInterval(timer)}if(done&&auto&&Date.now()>=autoAt&&document.visibilityState!=='hidden'){clearInterval(timer);go(false)}};
const timer=setInterval(tick,250);button.addEventListener('click',()=>go(true));tick();document.getElementById('reload-help').hidden=true})()</script></body></html>`;
}

function waitResponse(req: NextRequest, seconds: number): NextResponse {
  return new NextResponse(waitHtml(seconds, publicLocaleRoute(req.nextUrl.pathname)?.locale === "en"), {
    status: 429,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      "Retry-After": String(seconds),
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Deploy prewarm: curl on the server itself, keyed by a random per-deploy
 * token that deploy.yml puts into the process env before `pm2 start`.
 * Without a token in the env (dev, tests) nothing is exempt.
 */
export function isDeployWarmRequest(headers: { get(name: string): string | null }, token = process.env.DEPLOY_WARM_TOKEN): boolean {
  const presented = headers.get("x-deploy-warm");
  if (!token || token.length < 32 || !presented) return false;
  const expected = Buffer.from(token);
  const actual = Buffer.from(presented);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Next.js background fetches: client navigations and prefetches. Fetch
 * Metadata where the browser sends it; `_rsc` — Next's own mark on every
 * RSC fetch — for browsers that send none (iOS before 16.4, old WebViews).
 * Forging either only selects the bounded background budget.
 */
export function isBackgroundPageRequest(req: NextRequest): boolean {
  return req.headers.get("sec-fetch-dest") === "empty" || req.headers.get("rsc") === "1" || req.nextUrl.searchParams.has("_rsc");
}

export type PageGuardResult = {
  /** The wait page, when the request is over its budget. */
  limited: NextResponse | null;
  /** A new visitor cookie for the page response (guests without a valid one). */
  visitorCookie: string | null;
};

/** Sets the signed guest cookie on a page or wait response. */
export function applyVisitorCookie(res: NextResponse, req: NextRequest, token: string): void {
  res.cookies.set(VISITOR_COOKIE, token, {
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
    secure: (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol).startsWith("https"),
  });
}

type Check = { table: typeof limiter; subject: string; scale: number };

/** Called only after the proxy's existing authorization decisions. */
export async function pageNavigationGuard(req: NextRequest, verifiedUserId?: unknown): Promise<PageGuardResult> {
  const result: PageGuardResult = { limited: null, visitorCookie: null };
  if (!isLimitedPageRequest(req) || isDeployWarmRequest(req.headers)) return result;
  const userAgent = req.headers.get("user-agent");
  const automated = hasAutomationUserAgent(userAgent);
  const background = isBackgroundPageRequest(req);
  const ip = trustedClientIp(req.headers);
  const userId = verifiedUser(verifiedUserId);
  const crawler = userId ? null : claimedCrawler(userAgent);
  const verifiedCrawler = Boolean(crawler && ip && await crawlers.verify(ip, crawler));
  const client: PageLimitClient = verifiedCrawler ? "crawler" : crawler ? "fake-crawler" : isMobileAppUserAgent(userAgent) ? "app" : automated ? "automation" : "browser";

  let subject: PageLimitSubject;
  let checks: Check[];
  if (userId) {
    subject = "user";
    checks = [{ table: limiter, subject: pageNavigationSubject(req.headers, userId), scale: PAGE_NAVIGATION_LIMITS.userScale }];
  } else {
    const visitorId = verifiedVisitorId(req.cookies.get(VISITOR_COOKIE)?.value);
    if (visitorId && visitors.admits(`visitor:${visitorId}`)) {
      subject = "visitor";
      // The browser's own budget, and a ceiling for all cookie holders of one address.
      checks = [
        { table: limiter, subject: `ipcap:${ip ?? "unknown"}`, scale: PAGE_NAVIGATION_LIMITS.visitorIpScale },
        { table: visitors, subject: `visitor:${visitorId}`, scale: 1 },
      ];
    } else {
      subject = ip ? "ip" : "unknown";
      checks = [{ table: limiter, subject: pageNavigationSubject(req.headers), scale: 1 }];
      if (!visitorId && !verifiedCrawler) result.visitorCookie = issueVisitorToken();
    }
  }

  const mode = pageLimitMode();
  let decision: PageLimitDecision = { wait: 0, reason: null };
  if (!verifiedCrawler && !mode.off) {
    for (const check of checks) {
      decision = check.table.decide(check.subject, automated, background, check.scale * mode.scale);
      if (decision.wait) break;
    }
  }
  recordPageLimit({
    limited: decision.wait > 0,
    reason: decision.reason,
    subject,
    client,
    platform: platformOf(userAgent),
    background,
    metadata: req.headers.has("sec-fetch-dest"),
    section: sectionOf(req.nextUrl.pathname),
  });
  if (!decision.wait) return result;
  result.limited = waitResponse(req, decision.wait);
  // A guest who waits keeps the cookie: after the pause it gets a budget of its own.
  if (result.visitorCookie) applyVisitorCookie(result.limited, req, result.visitorCookie);
  result.visitorCookie = null;
  return result;
}

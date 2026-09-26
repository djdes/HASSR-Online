// Обход всего сайта глазами приложения WeSetup (UA WeSetupApp) на стенде 3022.
// Роли входят один раз (куки кешируются в d:/wt/tmp/sweep/state-<role>.json).
// Env: SWEEP_ROLES=ownerA,headA  SWEEP_VPS=a360,a412,i390,plain360  SWEEP_ONLY=regex  SWEEP_TAG=name SWEEP_DARK=1
// Запуск: node --import tsx .agent/tasks/mobile-apps-2026-09/e2e/sweep-app.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { installCapacitorStub, DEFAULT_STUB } from "./bridge-stub";

process.env.NEXTAUTH_SECRET ||= "e2e-stand-secret";
const BASE = process.env.SWEEP_BASE ?? "http://localhost:3022";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = "d:/wt/tmp/sweep";
fs.mkdirSync(SHOTS, { recursive: true });
const PASSWORD = "E2eTest2026!";
const EMAILS: Record<string, string> = {
  ownerA: "owner-a@e2e.local",
  headA: "head-a@e2e.local",
  cookA: "cook-a@e2e.local",
  cleanerA: "cleaner-a@e2e.local",
  managerA: "manager-a@e2e.local",
};
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 WeSetupApp/1.0.0 (android)";
const IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WeSetupApp/1.0.0 (ios)";
const PLAIN =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const VPS: Record<string, { ua: string; w: number; h: number; stub: "android" | "ios" | null }> = {
  a360: { ua: ANDROID, w: 360, h: 740, stub: "android" },
  a412: { ua: ANDROID, w: 412, h: 915, stub: "android" },
  i390: { ua: IOS, w: 390, h: 844, stub: "ios" },
  plain360: { ua: PLAIN, w: 360, h: 740, stub: null },
};
const HIDE_DEV =
  "window.__name=window.__name||function(f){return f};" +
  "try{localStorage.setItem('wesetup.last-seen-build-sha','zzz');localStorage.setItem('wesetup.mini.tour.seen',String(Date.now()))}catch(e){};" +
  "document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})";

async function roleState(browser: Browser, role: string) {
  const file = `${SHOTS}/state-${role}.json`;
  if (fs.existsSync(file)) return file;
  const ctx = await browser.newContext();
  const csrf = (await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json()) as { csrfToken: string };
  await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email: EMAILS[role], password: PASSWORD, json: "true", callbackUrl: `${BASE}/mini` },
    maxRedirects: 0,
  });
  if (!(await ctx.cookies(BASE)).some((c) => /session/i.test(c.name))) throw new Error("sign-in failed " + role);
  await ctx.storageState({ path: file });
  await ctx.close();
  return file;
}

const PROBE = () => {
  const de = document.documentElement;
  const vw = window.innerWidth;
  const desc = (el: Element) => {
    const c = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "";
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${c.replace(/\s+/g, ".").slice(0, 70)} "${((el as HTMLElement).innerText || "").replace(/\s+/g, " ").slice(0, 30)}"`;
  };
  const inScroller = (el: Element) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) return true;
      p = p.parentElement;
    }
    return false;
  };
  const wide: string[] = [];
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > vw + 1 && !inScroller(el)) {
      if (wide.length < 5) wide.push(desc(el) + ` right=${Math.round(r.right)}`);
    }
  }
  const header = document.querySelector("header.mini-topbar") as HTMLElement | null;
  const nav = document.querySelector(".mini-nav-rail") as HTMLElement | null;
  const hb = header ? header.getBoundingClientRect().bottom : 0;
  const main = document.querySelector("#mini-root main") as HTMLElement | null;
  let underHeader: string | null = null;
  if (main && header && window.scrollY === 0) {
    const firsts = Array.from(main.querySelectorAll("h1,h2,p,button,a,input,label")).filter(
      (e) => (e as HTMLElement).offsetParent && getComputedStyle(e).position !== "fixed"
    );
    const f = firsts[0];
    if (f && f.getBoundingClientRect().top < hb - 1)
      underHeader = desc(f) + ` top=${Math.round(f.getBoundingClientRect().top)} hb=${Math.round(hb)}`;
  }
  // Вырез экрана: Android отдаёт его переменной --safe-area-inset-top (заглушка ставит 44px).
  const inset = parseFloat(getComputedStyle(de).getPropertyValue("--safe-area-inset-top")) || 0;
  let underStatus: string | null = null;
  if (inset > 0 && window.scrollY === 0) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent || !n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || !el.offsetParent && getComputedStyle(el).position !== "fixed") continue;
      if (el.closest("nextjs-portal,[aria-hidden=true]")) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.height > 0 && r.width > 0 && r.top < inset - 1 && r.bottom > 0) {
        underStatus = desc(el) + ` top=${Math.round(r.top)} inset=${inset}`;
        break;
      }
    }
  }
  const bodyText = document.body.innerText;
  const payLinks = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => a.getAttribute("href") || "")
    .filter((h) => /\/order\b|\/pricing\b|robokassa|\/payment\b|\/api\/payment/.test(h));
  const payTexts = Array.from(
    new Set(
      bodyText.match(
        /(Оплатить[^\n]{0,30}|Пополнить[^\n]{0,30}|Продлить подписку|Улучшить тариф|Купить[^\n]{0,20}|Перейти на тариф[^\n]{0,20}|Сменить тариф[^\n]{0,20})/g
      ) || []
    )
  );
  const tgTexts = Array.from(new Set(bodyText.match(/[^\n]{0,40}(Telegram|Телеграм|телеграм)[^\n]{0,40}/g) || [])).slice(0, 6);
  const tgLinks = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => a.getAttribute("href") || "")
    .filter((h) => /t\.me\/|tg:\/\//.test(h))
    .slice(0, 5);
  return {
    path: location.pathname + location.search,
    miniRoot: !!document.getElementById("mini-root"),
    header: !!header,
    nav: !!nav,
    headerBottom: Math.round(hb),
    navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
    scrollW: de.scrollWidth,
    vw,
    wide,
    underHeader,
    underStatus,
    payLinks,
    payTexts,
    tgTexts,
    tgLinks,
    theme: document.getElementById("mini-root")?.getAttribute("data-theme") ?? null,
    h1: (document.querySelector("main h1, h1") as HTMLElement | null)?.innerText?.slice(0, 60) ?? null,
    text: (main || document.body).innerText.replace(/\s+/g, " ").slice(0, 140),
  };
};

// После прокрутки вниз: последний видимый элемент содержимого не под нижним меню.
const BOTTOM_PROBE = () => {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" as ScrollBehavior });
  const nav = document.querySelector(".mini-nav-rail") as HTMLElement | null;
  const main = document.querySelector("#mini-root main") as HTMLElement | null;
  if (!nav || !main) return null;
  const nt = nav.getBoundingClientRect().top;
  let worst: { d: string; b: number } | null = null;
  for (const el of Array.from(main.querySelectorAll("button,a,input,textarea,select,p,span,h2,h3,li,td"))) {
    const e = el as HTMLElement;
    if (!e.offsetParent || e.children.length > 3) continue;
    const r = e.getBoundingClientRect();
    if (r.height === 0 || r.bottom > window.innerHeight + 2 || r.top > window.innerHeight) continue;
    let fixed = false;
    for (let p: HTMLElement | null = e; p && p !== main; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (pos === "fixed" || pos === "sticky") { fixed = true; break; }
    }
    if (fixed || e.closest("[role=dialog]")) continue;
    if (r.bottom > nt + 1 && (!worst || r.bottom > worst.b))
      worst = { d: `${e.tagName} "${e.innerText.replace(/\s+/g, " ").slice(0, 30)}"`, b: Math.round(r.bottom) };
  }
  window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  return worst ? { ...worst, navTop: Math.round(nt) } : null;
};

async function ctxFor(browser: Browser, role: string | null, vpKey: string, dark: boolean): Promise<BrowserContext> {
  const vp = VPS[vpKey];
  const ctx = await browser.newContext({
    storageState: role ? await roleState(browser, role) : undefined,
    serviceWorkers: "block",
    userAgent: vp.ua,
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    colorScheme: dark ? "dark" : "light",
  });
  await ctx.addInitScript(HIDE_DEV);
  if (dark) await ctx.addInitScript(`try{localStorage.setItem("wesetup-app-theme","dark")}catch(e){}`);
  if (vp.stub) await ctx.addInitScript(installCapacitorStub, { ...DEFAULT_STUB, platform: vp.stub, permission: "denied" as const, topInset: vp.stub === "android" ? 44 : 0 });
  return ctx;
}

async function extraRoutes(): Promise<string[]> {
  const { qrFillUrl } = await import("../../../../src/lib/qr-fill-poster");
  const { journalShortQrUrl } = await import("../../../../src/lib/journal-pdf-qr-link");
  const ids = JSON.parse(fs.readFileSync(`${SHOTS}/ids.json`, "utf8"));
  const r = [
    "/mini", "/mini/me", "/mini/login", "/mini/journals", "/mini/today", "/mini/reports", "/mini/staff",
    "/mini/equipment", "/mini/shift", "/mini/sections", "/delete-account", "/settings/subscription",
    "/settings/balance", "/mini/balance", "/reports",
    ...ids.docs.map((d: string) => d),
    ...ids.codes.map((c: string) => `/journals/${c}`),
    ...ids.docs.map((d: string) => `/mini/documents/${d.split("/documents/")[1]}`),
    qrFillUrl("", "journal", `${ids.org}:hygiene`),
    journalShortQrUrl("", ids.org, "hygiene"),
  ];
  if (ids.room) r.push(qrFillUrl("", "room", ids.room));
  if (ids.equipment) r.push(qrFillUrl("", "equipment", ids.equipment));
  return r;
}

async function main() {
  const roles = (process.env.SWEEP_ROLES ?? "ownerA").split(",");
  const vps = (process.env.SWEEP_VPS ?? "a360").split(",");
  const tag = process.env.SWEEP_TAG ?? "run";
  const dark = process.env.SWEEP_DARK === "1";
  const only = process.env.SWEEP_ONLY ? new RegExp(process.env.SWEEP_ONLY) : null;
  const shots = process.env.SWEEP_SHOTS !== "0";
  let routes: string[] = process.env.SWEEP_ROUTES
    ? process.env.SWEEP_ROUTES.split(",")
    : [
        ...(await extraRoutes()),
        ...JSON.parse(fs.readFileSync("D:/www/Wesetup.ru/.agent/tasks/mini-sweep-2026-09/parity-routes.json", "utf8")),
      ];
  if (only) routes = routes.filter((r) => only.test(r));
  const browser = await chromium.launch({ headless: true });
  const report: Record<string, unknown>[] = [];
  const outFile = path.join(HERE, `sweep-${tag}.json`);
  try {
    for (const role of roles)
      for (const vpKey of vps) {
        const ctx = await ctxFor(browser, role === "anon" ? null : role, vpKey, dark);
        const page = await ctx.newPage();
        let errs: string[] = [];
        let metrika = 0;
        let hydr = 0;
        page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 200)));
        page.on("console", (m) => {
          if (m.type() !== "error" || /Failed to load resource|DevTools|Download the React/i.test(m.text())) return;
          // Расхождение атрибутов при гидрации (PartnerHint, telegram-web-app.js на <html>) —
          // есть и в обычном браузере, считаем отдельно.
          if (/hydrated but some attributes/.test(m.text())) hydr++;
          else errs.push("console: " + m.text().slice(0, 200));
        });
        page.on("request", (r) => {
          if (/mc\.yandex|metrika/i.test(r.url())) metrika++;
        });
        page.on("response", (r) => {
          const s = r.status();
          const u = r.url();
          if (s >= 400 && s !== 401 && s !== 403 && !/telegram\.org|webpack-hmr|favicon/.test(u))
            errs.push(`http ${s} ${u.replace(BASE, "").slice(0, 100)}`);
        });
        page.on("requestfailed", (r) => {
          const u = r.url();
          const t = r.failure()?.errorText ?? "";
          if (!/telegram\.org|webpack-hmr|mc\.yandex/.test(u) && !/ERR_ABORTED/.test(t))
            errs.push(`fail ${t} ${u.replace(BASE, "").slice(0, 100)}`);
        });
        for (const route of routes) {
          errs = [];
          metrika = 0;
          hydr = 0;
          const row: Record<string, unknown> = { role, vp: vpKey, dark, route };
          try {
            const resp = await page.goto(`${BASE}${route}`, { waitUntil: "load", timeout: 240000 });
            await page.waitForTimeout(1500);
            row.status = resp?.status();
            // Клиентские редиректы (/mini/journals → кабинет): ждём, пока адрес устоится.
            for (let i = 0; ; i++) {
              try {
                await page.waitForLoadState("load");
                Object.assign(row, await page.evaluate(PROBE));
                row.underNav = await page.evaluate(BOTTOM_PROBE);
                break;
              } catch (e) {
                if (i >= 3) throw e;
                await page.waitForTimeout(2000);
              }
            }
            row.hydr = hydr;
            row.metrika = metrika;
            row.errs = errs.slice(0, 6);
            const name = `${tag}.${role}.${vpKey}.${route.replace(/\W+/g, "_").slice(0, 60)}.png`;
            if (shots) await page.screenshot({ path: `${SHOTS}/${name}` });
            row.shot = name;
            const p = row as Record<string, any>;
            const flags = [
              p.status >= 400 && `HTTP ${p.status}`,
              !p.miniRoot && "NO-SHELL",
              p.scrollW > p.vw + 1 && `OVERFLOW ${p.scrollW}>${p.vw}`,
              p.wide.length && `WIDE ${p.wide[0]}`,
              p.underHeader && `UNDER-HEADER ${p.underHeader}`,
              p.underStatus && `UNDER-STATUSBAR ${p.underStatus}`,
              p.underNav && `UNDER-NAV ${JSON.stringify(p.underNav)}`,
              p.payLinks.length && `PAYLINK ${p.payLinks.join(" ")}`,
              p.payTexts.length && `PAYTEXT ${p.payTexts.join(" | ")}`,
              p.tgLinks.length && `TGLINK ${p.tgLinks.join(" ")}`,
              p.metrika && `METRIKA ${p.metrika}`,
              p.errs.length && `ERR ${p.errs.join(" || ")}`,
            ].filter(Boolean);
            row.flags = flags;
            console.log(`[${role} ${vpKey}] ${route} ${p.status} -> ${p.path}  ${flags.length ? flags.join(" ## ") : "ok"}`);
          } catch (e) {
            row.error = String(e).slice(0, 300);
            console.log(`[${role} ${vpKey}] ${route} ERROR ${row.error}`);
          }
          report.push(row);
          fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
        }
        await ctx.close();
      }
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});

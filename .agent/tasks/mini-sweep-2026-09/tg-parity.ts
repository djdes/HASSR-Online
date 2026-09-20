// Паритет: разделы сайта, открытые из мини-приложения внутри «Telegram», должны рисоваться в оболочке мини-приложения.
import crypto from "node:crypto"; import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
import { db } from "../journal-responsibles-org-2026-09/e2e/db";
const BASE = process.env.SWEEP_BASE ?? "http://localhost:3021"; const TOKEN = process.env.TG_FAKE_TOKEN!;
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const OUT = process.env.SWEEP_OUT!; fs.mkdirSync(OUT, { recursive: true });
const HOST = fs.readFileSync(path.join(HERE, "tg-host.js"), "utf8");
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8"));
const ROLE = process.env.SWEEP_ROLE ?? "ownerA"; const ONLY = process.env.SWEEP_ONLY ? new RegExp(process.env.SWEEP_ONLY) : null;
const TG_IDS: Record<string, number> = { cookA: 990001, managerA: 990002, cleanerA: 990003, headA: 990004, ownerA: 990005 };
const LIGHT = { bg_color: "#ffffff", text_color: "#000000", hint_color: "#999999", link_color: "#2481cc", button_color: "#2481cc", button_text_color: "#ffffff", secondary_bg_color: "#efeff4" };
function forge(tgId: number): string {
  const p = new URLSearchParams(); p.set("auth_date", String(Math.floor(Date.now() / 1000) - 5)); p.set("query_id", "AAE2E" + tgId);
  p.set("user", JSON.stringify({ id: tgId, first_name: "Тест", username: "e2e_" + tgId, language_code: "ru" }));
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n"); const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  p.set("hash", crypto.createHmac("sha256", secret).update(dcs).digest("hex")); return p.toString();
}
const PROBE = `(function(){var de=document.documentElement;var root=document.getElementById('mini-root');var h=window.__tgHost||{};
 var wide=[];Array.from(document.querySelectorAll('main *')).forEach(function(el){var r=el.getBoundingClientRect();if(r.width>0&&r.right>de.clientWidth+2){var p=el.parentElement,inScroller=false;while(p&&p!==document.body){var o=getComputedStyle(p).overflowX;if(o==='auto'||o==='scroll'){inScroller=true;break}p=p.parentElement}if(!inScroller&&wide.length<4)wide.push((el.tagName+'.'+String(el.className).slice(0,50)+' r='+Math.round(r.right)))}});
 var small=Array.from(document.querySelectorAll('main input:not([type=checkbox]):not([type=radio]):not([type=hidden]),main textarea,main select')).filter(function(el){return el.offsetParent&&parseFloat(getComputedStyle(el).fontSize)<16}).length;
 return {path:location.pathname,miniShell:!!root,siteHeader:!!document.querySelector('header [data-site-header], header a[href="/dashboard"]'),siteFooter:!!document.querySelector('footer'),miniNav:!!document.querySelector('.mini-root nav'),back:h.backVisible,pageSW:de.scrollWidth,vw:de.clientWidth,wide:wide,smallInputs:small,title:(document.querySelector('.mini-root header')||{}).innerText?document.querySelector('.mini-root header').innerText.replace(/\\s+/g,' ').slice(0,60):null,h1:(document.querySelector('main h1')||{}).innerText||null,text:(document.querySelector('main')||document.body).innerText.replace(/\\s+/g,' ').slice(0,110)}})()`;
(async () => {
  const email = state.users[ROLE].email; const tgId = TG_IDS[ROLE];
  await db.user.updateMany({ where: { telegramChatId: String(tgId) }, data: { telegramChatId: null } });
  await db.user.update({ where: { email }, data: { telegramChatId: String(tgId) } });
  const routes: string[] = process.env.SWEEP_ROUTES ? process.env.SWEEP_ROUTES.split(",").map((r) => "/" + r) : JSON.parse(fs.readFileSync(path.join(HERE, "parity-routes.json"), "utf8"));
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Telegram-iOS/11.2" });
  await ctx.addInitScript(`window.__tgHostConfig=${JSON.stringify({ themeParams: LIGHT })};` + HOST);
  await ctx.addInitScript(`try{localStorage.setItem("wesetup.mini.tour.seen",String(Date.now()));localStorage.setItem("wesetup.last-seen-build-sha","zzz")}catch(e){}`);
  const page = await ctx.newPage(); let errs: string[] = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error" && !/hydrat|DevTools|same key|Failed to load resource/i.test(m.text())) errs.push("console: " + m.text().slice(0, 160)); });
  page.on("response", (r) => { if (r.status() >= 500) errs.push(`http ${r.status()} ${r.url().replace(BASE, "").slice(0, 90)}`); });
  const hash = "#tgWebAppData=" + encodeURIComponent(forge(tgId)) + "&tgWebAppVersion=8.0&tgWebAppPlatform=ios&tgWebAppThemeParams=" + encodeURIComponent(JSON.stringify(LIGHT));
  await page.goto(`${BASE}/mini${hash}`, { waitUntil: "load", timeout: 300000 });
  await page.waitForFunction(`!/Загружаем кабинет/.test(document.body.innerText)`, null, { timeout: 120000 }).catch(() => null); await page.waitForTimeout(1500);
  console.log("cookies", (await ctx.cookies()).map((c) => c.name).join(","));
  const report: any[] = [];
  for (const route of routes) {
    if (ONLY && !ONLY.test(route)) continue; errs = [];
    try {
      const resp = await page.goto(`${BASE}${route}`, { waitUntil: "load", timeout: 300000 }); await page.waitForTimeout(1800);
      const p: any = await page.evaluate(PROBE); const name = route.replace(/\W+/g, "_").slice(0, 60);
      await page.screenshot({ path: path.join(OUT, `${ROLE}.${name}.png`) });
      const row = { route, status: resp?.status(), ...p, errs: errs.slice(0, 4) }; report.push(row);
      const flags = [!p.miniShell && "NO-SHELL", p.siteFooter && "FOOTER", !p.back && p.path !== "/mini" && "NO-BACK", p.pageSW > p.vw + 2 && `OVERFLOW ${p.pageSW}`, p.smallInputs && `SMALL-INPUTS ${p.smallInputs}`, p.path !== route.split("?")[0] && `→ ${p.path}`, errs.length && `ERR ${errs[0]}`].filter(Boolean);
      console.log(route, resp?.status(), flags.length ? flags.join(" | ") : "ok", p.wide.length ? JSON.stringify(p.wide.slice(0, 2)) : "");
    } catch (e) { report.push({ route, error: String(e).slice(0, 200) }); console.log(route, "ERR", String(e).slice(0, 140)); }
    fs.writeFileSync(path.join(OUT, `tg-parity.${ROLE}.json`), JSON.stringify(report, null, 1));
  }
  await browser.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 400)); process.exit(1); });

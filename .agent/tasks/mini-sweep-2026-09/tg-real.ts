// Настоящий Telegram Desktop: подключение к окну мини-приложения через отладочный порт WebView2. ТОЛЬКО чтение: ходим по экранам, ничего не сохраняем.
import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
const OUT = process.env.SWEEP_OUT!; fs.mkdirSync(OUT, { recursive: true });
const ROUTES = (process.env.SWEEP_ROUTES ?? "").split(",").filter(Boolean).map((r) => "/" + r);
const PROBE = `(function(){var de=document.documentElement;var tg=window.Telegram&&window.Telegram.WebApp;var cs=getComputedStyle(de);var root=document.getElementById('mini-root');
 var wide=[];Array.from(document.querySelectorAll('main *')).forEach(function(el){var r=el.getBoundingClientRect();if(r.width>0&&r.right>de.clientWidth+2){var p=el.parentElement,ok=false;while(p&&p!==document.body){var o=getComputedStyle(p).overflowX;if(o==='auto'||o==='scroll'){ok=true;break}p=p.parentElement}if(!ok&&wide.length<3)wide.push(el.tagName+'.'+String(el.className).slice(0,40))}});
 var nav=document.querySelector('.mini-root nav');var nr=nav?nav.getBoundingClientRect():null;
 return {path:location.pathname,vw:innerWidth,vh:innerHeight,dpr:devicePixelRatio,pageSW:de.scrollWidth,miniShell:!!root,theme:root?root.dataset.theme:null,footer:!!document.querySelector('footer'),navBottomGap:nr?Math.round(innerHeight-nr.bottom):null,wide:wide,
  tg:tg?{platform:tg.platform,version:tg.version,scheme:tg.colorScheme,hasInitData:!!tg.initData,expanded:tg.isExpanded,viewportH:tg.viewportHeight,stableH:tg.viewportStableHeight,fullscreen:tg.isFullscreen,safe:tg.safeAreaInset,contentSafe:tg.contentSafeAreaInset,backVisible:tg.BackButton&&tg.BackButton.isVisible,headerColor:tg.headerColor,bg:tg.backgroundColor}:null,
  cookieShell:document.cookie.indexOf('ws-shell=mini')>=0,title:(document.querySelector('.mini-root header')||{innerText:''}).innerText.replace(/\\s+/g,' ').slice(0,50),text:(document.querySelector('main')||document.body).innerText.replace(/\\s+/g,' ').slice(0,140)}})()`;
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9334");
  const pages = browser.contexts().flatMap((c) => c.pages()); console.log("pages", pages.map((p) => p.url().split("#")[0]));
  const page = pages.find((p) => /wesetup\.ru/.test(p.url())) ?? pages[0]; if (!page) throw new Error("no page");
  const errs: string[] = []; page.on("pageerror", (e) => errs.push("pageerror " + String(e).slice(0, 150)));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console " + m.text().slice(0, 150)); });
  page.on("response", (r) => { if (r.status() >= 400 && /wesetup\.ru/.test(r.url()) && !/_next\/static/.test(r.url())) errs.push(`http ${r.status()} ${r.url().replace("https://wesetup.ru", "").slice(0, 80)}`); });
  await page.waitForLoadState("load").catch(() => null); await page.waitForTimeout(2500);
  if (!/wesetup\.ru/.test(page.url())) { console.log("NOT-WESETUP", page.url().slice(0, 80)); await browser.close(); return; }
  const log: any[] = []; const snap = async (name: string) => { const p: any = await page.evaluate(PROBE); await page.screenshot({ path: path.join(OUT, name + ".png") }).catch(() => null); log.push({ name, ...p, errs: errs.splice(0, 5) }); console.log(name, JSON.stringify(p).slice(0, 900), log[log.length - 1].errs.join(" | ")); };
  await snap("00-start");
  for (const r of ROUTES) { await page.evaluate(`(function(){var a=document.createElement('a');a.href=${JSON.stringify(r)};document.body.appendChild(a);a.click();a.remove()})()`); await page.waitForLoadState("load").catch(() => null); await page.waitForTimeout(3000); await snap(r.replace(/\W+/g, "_")); }
  fs.writeFileSync(path.join(OUT, "tg-real.json"), JSON.stringify(log, null, 1));
  await browser.close(); // для connectOverCDP это только отключение, окно Telegram остаётся
})().catch((e) => { console.log("FATAL", String(e).slice(0, 300)); process.exit(1); });

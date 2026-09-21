import { chromium } from "playwright";
import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
import { clickText } from "./dbl";
(async () => {
// 1) сотрудник в отпуске
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await go(p, "http://localhost:3021/mini/login?phone=%2B7%20921%20777-66-55", 6000);
await p.waitForFunction(`/Войти/.test(document.body.innerText)`, undefined, { timeout: 180000 });
await p.waitForTimeout(2500);
await p.fill('input[name="password"]', "ZZ6parol123");
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Войти').click()`);
await p.waitForTimeout(12000);
const pr = await probe(p);
console.log("TODAY url", pr.url);
console.log(pr.bodyText.slice(0, 700));
await shot(p, "70-vac-today-vp");
const api: any = await p.evaluate(`fetch('/api/mini/today',{cache:'no-store'}).then(r=>r.json())`);
console.log("scheduleStatus:", JSON.stringify(api.scheduleStatus), "note:", JSON.stringify(api.scheduleNote));
await browser.close();
// 2) заведующая: панель контроля + напомнить всем
const h = await openTelegramSession({ role: "headA", width: 360, height: 640 });
await go(h.page, h.base + "/control-board", 6000);
await h.page.waitForFunction(`/Панель контроля/.test(document.body.innerText)`, undefined, { timeout: 180000 });
await h.page.waitForTimeout(6000);
const cb = (await probe(h.page)).bodyText;
console.log("ZZ6 упомянут на панели?", cb.includes("ZZ6 Новичок 9208"));
const idx = cb.indexOf("ZZ6 Новичок 9208");
console.log("контекст:", idx>=0 ? cb.slice(Math.max(0,idx-200), idx+200).replace(/\n/g," | ") : "—");
await shot(h.page, "70-cb-vp");
const remind: any = await h.page.evaluate(`fetch('/api/control-board/remind',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({all:true})}).then(async r=>({s:r.status,j:await r.text()}))`);
console.log("REMIND ALL:", JSON.stringify(remind).slice(0,800));
console.log("ERRORS", JSON.stringify(h.errors).slice(0,400));
await h.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });

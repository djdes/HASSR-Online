import { chromium } from "playwright";
import { shot, go, probe } from "./lib";
import { db } from "../tg-session";
(async () => {
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errors: string[] = [];
p.on("response", r => { if (r.status()>=400 && !/_next\/static|favicon/.test(r.url())) errors.push(r.status()+" "+r.request().method()+" "+r.url().replace("http://localhost:3021","")); });
await go(p, "http://localhost:3021/mini/login?phone=%2B7%20921%20777-66-55", 6000);
await p.waitForFunction(`/Войти/.test(document.body.innerText)`, undefined, { timeout: 180000 });
await p.waitForTimeout(3000);
await p.fill('input[name="password"]', "ZZ6parol123");
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Войти').click()`);
await p.waitForTimeout(12000);
console.log("URL after login", p.url());
const pr = await probe(p);
console.log(pr.bodyText.slice(0,1600));
await shot(p, "61-new-after-login-vp");
// журналы
await go(p, "http://localhost:3021/journals", 6000);
await p.waitForTimeout(9000);
const j = await probe(p);
console.log("JOURNALS url", j.url);
console.log(j.bodyText.slice(0,900));
await shot(p, "61-new-journals-vp");
// задачи
await go(p, "http://localhost:3021/mini/today", 5000);
await p.waitForTimeout(7000);
const t = await probe(p);
console.log("TODAY:", t.bodyText.slice(0,700).replace(/\n/g," | "));
await shot(p, "61-new-today-vp");
console.log("ERRORS", JSON.stringify(errors).slice(0,500));
await browser.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });

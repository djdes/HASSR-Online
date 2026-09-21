import { chromium } from "playwright";
import { shot, go, probe } from "./lib";
import { db } from "../tg-session";
(async () => {
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const logs: string[] = [];
p.on("console", m => { if (m.type()==="error"||m.type()==="warning") logs.push(m.type()+": "+m.text().slice(0,400)); });
p.on("pageerror", e => logs.push("pageerror: "+String(e).slice(0,400)));
await go(p, "http://localhost:3021/mini/login?phone=%2B7%20921%20777-66-55", 6000);
await p.waitForFunction(`/Войти/.test(document.body.innerText)`, undefined, { timeout: 180000 });
await p.waitForTimeout(2000);
await p.fill('input[name="password"]', "ZZ6parol123");
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Войти').click()`);
await p.waitForTimeout(13000);
console.log("LOGS:\n" + logs.join("\n"));
await browser.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });

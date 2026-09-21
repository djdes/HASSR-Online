import { chromium } from "playwright";
import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
import { clickText } from "./dbl";
(async () => {
// новый токен
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
await go(s.page, s.base + "/settings/users", 5000);
await s.page.waitForFunction(`/Пригласить по QR/.test(document.body.innerText)`, undefined, { timeout: 180000 });
await s.page.waitForTimeout(4000);
await clickText(s.page, "Пригласить по QR"); await s.page.waitForTimeout(2500);
await clickText(s.page, "Сгенерировать QR-код"); await s.page.waitForTimeout(5000);
const LINK = await s.page.evaluate(`(()=>{const i=[...document.querySelectorAll('input')].map(e=>e.value).filter(v=>v&&v.indexOf('/join/')>=0);return i[0]||null})()`);
console.log("LINK2", LINK);
await s.close();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errors: string[] = [];
p.on("response", r => { if (r.status()>=400 && !/_next\/static|favicon/.test(r.url())) errors.push(r.status()+" "+r.request().method()+" "+r.url().replace("http://localhost:3021","")); });
await go(p, String(LINK), 6000);
await p.waitForFunction(`/Зарегистрироваться/.test(document.body.innerText)`, undefined, { timeout: 180000 });
await p.waitForTimeout(3000);
await p.fill('input[placeholder="Иванов Иван Иванович"]', "ZZ6 Дубль телефона");
await p.fill('input[type=tel]', "+7 921 777 66 55");
await p.selectOption('select', { label: "Повар" });
await p.fill('input[type=password]', "ZZ6parol456");
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>/Зарегистрироваться/.test(x.innerText)).click()`);
await p.waitForTimeout(6000);
console.log("DUP RESULT:\n" + (await probe(p)).bodyText.slice(0,1300));
await shot(p, "62-dup-vp");
console.log("ERRORS", JSON.stringify(errors));
await browser.close();

// /login сайта: телефон в поле почты
const b2 = await chromium.launch({ headless: true });
const c2 = await b2.newContext({ viewport: { width: 1280, height: 900 } });
const p2 = await c2.newPage();
await go(p2, "http://localhost:3021/login", 6000);
await p2.waitForTimeout(8000);
console.log("LOGIN FIELDS", JSON.stringify(await p2.evaluate(`[...document.querySelectorAll('input')].map(e=>e.type+' name='+e.name+' ph='+(e.placeholder||''))`)));
await p2.evaluate(`(()=>{const e=document.querySelector('input[type=email],input[name=email]');const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;set.call(e,'+79217776655');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));})()`);
await p2.waitForTimeout(1500);
console.log("after phone in email:\n" + (await probe(p2)).bodyText.slice(0,1200));
await shot(p2, "62-login-phone");
await p2.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Войти/.test(x.innerText));b&&b.click();})()`);
await p2.waitForTimeout(3000);
console.log("after submit:\n" + (await probe(p2)).bodyText.slice(0,1200));
await shot(p2, "62-login-phone2");
await b2.close();
await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });

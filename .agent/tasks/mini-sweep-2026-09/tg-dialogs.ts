// «Telegram» на стенде: на каждом экране нажимаем кнопки, открывающие окна, и проверяем, что окно целиком на экране, не под нижним меню, поля ≥16px.
import crypto from "node:crypto"; import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
import { db } from "../journal-responsibles-org-2026-09/e2e/db";
const BASE = "http://localhost:3021"; const TOKEN = process.env.TG_FAKE_TOKEN!;
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")); const HOST = fs.readFileSync(path.join(HERE, "tg-host.js"), "utf8");
const OUT = process.env.SWEEP_OUT!; fs.mkdirSync(OUT, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8"));
const ROLE = process.env.SWEEP_ROLE ?? "ownerA"; const TG_IDS: Record<string, number> = { cookA: 990001, managerA: 990002, headA: 990004, ownerA: 990005 };
const VH = Number(process.env.SWEEP_VH ?? 590); const ONLY = process.env.SWEEP_ONLY ? new RegExp(process.env.SWEEP_ONLY) : null;
function forge(id: number) { const p = new URLSearchParams(); p.set("auth_date", String(Math.floor(Date.now() / 1000) - 5)); p.set("user", JSON.stringify({ id, first_name: "Т" })); const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n"); const s = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest(); p.set("hash", crypto.createHmac("sha256", s).update(dcs).digest("hex")); return p.toString(); }
const LIST = `(function(){var re=/^(\\+|Добавить|Создать|Нов|Пригласить|Изменить|Редактировать|Настро|Фильтр|Несколько|Загрузить|Поделиться|Шаблон|Инструкция|Как )/i;var bad=/удал|очист|сброс|выйти|отправить|сохран|применить|пересозд|перезапис|закрыть день|сгенерир|оплат|пополн/i;
 return Array.from(document.querySelectorAll('main button, main [role=button]')).filter(function(b){var t=(b.innerText||b.getAttribute('aria-label')||'').trim();var r=b.getBoundingClientRect();return b.offsetParent&&!b.disabled&&r.width>0&&!bad.test(t)&&!b.closest('nav')}).slice(0,9).map(function(b,i){b.setAttribute('data-sweep-btn',String(i));return (b.innerText||b.getAttribute('aria-label')||'').trim().replace(/\\s+/g,' ').slice(0,40)})})()`;
const DIALOG = `(function(){var ds=Array.from(document.querySelectorAll('[role=dialog],[role=alertdialog],[data-vaul-drawer],[data-state=open][role=menu],[data-radix-popper-content-wrapper]')).filter(function(d){var r=d.getBoundingClientRect();return r.width>60&&r.height>40});if(!ds.length)return null;var d=ds[ds.length-1];var r=d.getBoundingClientRect();var vw=innerWidth,vh=innerHeight;
 var nav=document.querySelector('.mini-root nav');var nr=nav?nav.getBoundingClientRect():null;
 var ctrls=Array.from(d.querySelectorAll('button,input,textarea,select,a')).filter(function(e){return e.offsetParent});var covered=[];ctrls.forEach(function(e){var b=e.getBoundingClientRect();if(b.width<4||b.bottom<0||b.top>vh)return;var cx=b.left+b.width/2,cy=Math.min(b.bottom-3,vh-1);var top=document.elementFromPoint(cx,cy);if(top&&!d.contains(top)&&!top.contains(e)&&covered.length<3)covered.push(((e.innerText||e.getAttribute('placeholder')||e.tagName)+'').trim().slice(0,25)+' <- '+top.tagName+'.'+String(top.className).slice(0,30))});
 var last=ctrls[ctrls.length-1];var lastB=last?last.getBoundingClientRect().bottom:0;var scrollable=d.scrollHeight>d.clientHeight+2||Array.from(d.querySelectorAll('*')).some(function(e){var o=getComputedStyle(e).overflowY;return (o==='auto'||o==='scroll')&&e.scrollHeight>e.clientHeight+2});
 var small=Array.from(d.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]),textarea,select')).filter(function(e){return e.offsetParent&&parseFloat(getComputedStyle(e).fontSize)<16}).length;
 return {role:d.getAttribute('role')||'popper',w:Math.round(r.width),h:Math.round(r.height),left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom),offX:r.left<-1||r.right>vw+1,offY:(r.top<-1||r.bottom>vh+1)&&!scrollable,lastCtrlBelow:lastB>vh+1&&!scrollable,covered:covered,small:small,title:(d.querySelector('h1,h2,h3,[data-slot=dialog-title]')||{innerText:''}).innerText.slice(0,40)}})()`;
(async () => {
  const tgId = TG_IDS[ROLE]; await db.user.updateMany({ where: { telegramChatId: String(tgId) }, data: { telegramChatId: null } }); await db.user.update({ where: { email: state.users[ROLE].email }, data: { telegramChatId: String(tgId) } });
  let routes: string[] = JSON.parse(fs.readFileSync(path.join(HERE, "parity-routes.json"), "utf8")); routes = ["/mini", "/mini/today", "/mini/journals", "/mini/staff", "/mini/equipment", "/mini/reports", "/mini/audit", "/mini/iot", "/mini/shift-handover", "/mini/shift", "/mini/balance", "/mini/me", "/mini/sections", ...routes.filter((r) => r !== "/staff" && r !== "/settings/equipment/qr-sheet")];
  const b = await chromium.launch({ headless: true }); const ctx = await b.newContext({ viewport: { width: 384, height: VH }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }); await ctx.addInitScript(HOST);
  await ctx.addInitScript(`try{localStorage.setItem("wesetup.mini.tour.seen",String(Date.now()));localStorage.setItem("wesetup.last-seen-build-sha","zzz")}catch(e){}`);
  const page = await ctx.newPage(); let errs: string[] = []; page.on("pageerror", (e) => errs.push("pageerror " + String(e).slice(0, 140)));
  page.on("response", (r) => { if (r.status() >= 500) errs.push(`http ${r.status()} ${r.url().replace(BASE, "").slice(0, 70)}`); });
  const hash = "#tgWebAppData=" + encodeURIComponent(forge(tgId)) + "&tgWebAppVersion=8.0&tgWebAppPlatform=ios"; await page.goto(`${BASE}/mini${hash}`, { waitUntil: "load", timeout: 300000 }); await page.waitForFunction(`!/Загружаем кабинет/.test(document.body.innerText)`, null, { timeout: 120000 }).catch(() => null);
  const report: any[] = [];
  for (const route of routes) { if (ONLY && !ONLY.test(route)) continue; errs = [];
    try { await page.goto(BASE + route, { waitUntil: "load", timeout: 300000 }); await page.waitForTimeout(1800); const labels: string[] = await page.evaluate(LIST);
      for (let i = 0; i < labels.length; i++) { const btn = page.locator(`[data-sweep-btn="${i}"]`).first(); if (!(await btn.isVisible().catch(() => false))) continue; const before = page.url();
        await btn.click({ timeout: 5000 }).catch(() => null); await page.waitForTimeout(900); const d: any = await page.evaluate(DIALOG).catch(() => null);
        if (d) { const bad = d.offX || d.offY || d.lastCtrlBelow || d.covered.length || d.small; if (bad) { await page.screenshot({ path: path.join(OUT, `${ROLE}.${route.replace(/\W+/g, "_")}.${i}.png`) }).catch(() => null); console.log(route, `«${labels[i]}»`, JSON.stringify({ t: d.title, offX: d.offX, offY: d.offY, below: d.lastCtrlBelow, covered: d.covered, small: d.small, box: [d.left, d.top, d.right, d.bottom] })); } report.push({ route, button: labels[i], ...d, bad }); }
        await page.keyboard.press("Escape").catch(() => null); await page.waitForTimeout(350);
        if (page.url() !== before) { await page.goto(BASE + route, { waitUntil: "load", timeout: 300000 }); await page.waitForTimeout(1200); await page.evaluate(LIST); } }
      if (errs.length) console.log(route, "ERR", errs[0]);
    } catch (e) { console.log(route, "FAIL", String(e).slice(0, 120)); }
    fs.writeFileSync(path.join(OUT, `tg-dialogs.${ROLE}.json`), JSON.stringify(report, null, 1)); }
  console.log("dialogs opened:", report.length, "bad:", report.filter((r) => r.bad).length); await b.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 300)); process.exit(1); });

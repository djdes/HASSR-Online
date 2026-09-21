// Проверка четвёртой пачки: регистрация по QR → вход по телефону → журналы видны; срок нарушения по умолчанию; двойной тап.
import { openTelegramSession, db } from "./tg-session"; import { chromium } from "playwright";
(async () => {
  const s = await openTelegramSession({ role: "ownerA" }); const p = s.page;
  await p.goto(s.base + "/capa/new", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(3500);
  console.log("нарушение по умолчанию:", JSON.stringify(await p.evaluate(`Array.from(document.querySelectorAll('main [role=combobox], main select')).map(function(e){return (e.innerText||e.value||'').trim()}).slice(0,4)`)));
  const title = "ZZ4 двойной тап " + Date.now(); await p.locator('main input').first().fill(title); const btn = p.getByRole("button", { name: /Создать нарушение/ }); await btn.evaluate((b: any) => { b.click(); b.click(); }); await p.waitForTimeout(4000);
  console.log("дублей:", await db.capaTicket.count({ where: { title } }));
  await p.goto(s.base + "/settings/users", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(3500); await p.getByRole("button", { name: /Пригласить по QR/ }).first().click(); await p.waitForTimeout(1200);
  await p.getByRole("button", { name: /Сгенерировать/ }).first().click(); await p.waitForTimeout(3500);
  console.log("окно QR:", JSON.stringify(await p.evaluate(`(function(){var c=Array.from(document.querySelectorAll('.fixed.inset-0 > div, [role=dialog]')).filter(function(e){return e.getBoundingClientRect().height>200}).pop();if(!c)return null;var r=c.getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom),vh:innerHeight,scrollable:c.scrollHeight>c.clientHeight+2}})()`)));
  const token = await db.employeeJoinToken.findFirst({ where: { organizationId: s.user.organizationId }, orderBy: { createdAt: "desc" }, select: { id: true } }); const link = await p.evaluate(`(document.body.innerText.match(/https?:\/\/[^\s]*\/join\/[A-Za-z0-9_-]+/)||[''])[0]`); console.log("ссылка:", String(link).replace(/join\/.*/, "join/…"), token ? "токен есть" : "");
  await s.close();
  if (link) { const b = await chromium.launch({ headless: true }); const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true }); const q = await ctx.newPage(); await q.goto(String(link).replace(/^https?:\/\/[^/]+/, "http://localhost:3021"), { waitUntil: "load", timeout: 300000 }); await q.waitForTimeout(3500);
    console.log("форма приглашения:", JSON.stringify(await q.evaluate(`({cookie:/cookies/i.test(document.body.innerText),position:(document.querySelector('select')||{}).value,text:document.body.innerText.replace(/\s+/g,' ').slice(0,120)})`))); await b.close(); }
})().catch((e) => { console.log("FATAL", String(e).slice(0, 300)); process.exit(1); });

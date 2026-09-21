// Проверка третьей пачки: колокольчик открывается, у задачи холодильника есть поле температуры и «Завершить» заблокирована, 404 в оболочке.
import { openTelegramSession } from "./tg-session";
const OUT = process.env.SWEEP_OUT!; import fs from "node:fs"; fs.mkdirSync(OUT, { recursive: true });
(async () => {
  { const s = await openTelegramSession({ role: "ownerA" }); const p = s.page; await p.waitForTimeout(2500);
    await p.locator('.mini-root header button[aria-label*="ведомлен"]').first().click(); await p.waitForTimeout(1500);
    console.log("колокольчик:", JSON.stringify(await p.evaluate(`(function(){var h=Array.from(document.querySelectorAll('h2,h3,div')).find(function(e){return e.innerText&&e.innerText.trim()==='Уведомления'});if(!h)return 'нет панели';var r=h.getBoundingClientRect();var top=document.elementFromPoint(r.left+10,r.top+r.height/2);return {visible:r.top>=0&&r.bottom<=innerHeight,onTop:top===h||h.contains(top)||top.contains(h)}})()`))); await p.screenshot({ path: OUT + "/bell.png" }); await p.keyboard.press("Escape");
    await p.goto(s.base + "/mini/o/nope-nope", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(3000); console.log("404:", JSON.stringify(await p.evaluate(`({shell:!!document.getElementById('mini-root'),nav:!!document.querySelector('.mini-nav-rail'),text:(document.querySelector('main')||document.body).innerText.replace(/\s+/g,' ').slice(0,60)})`))); await s.close(); }
  { const s = await openTelegramSession({ role: "cookA" }); const p = s.page; await p.waitForTimeout(3500);
    const open = p.getByRole("link", { name: /Открыть/ }).or(p.getByRole("button", { name: /Открыть/ })).first();
    console.log("сегодня:", (await p.evaluate(`(document.querySelector('main')||document.body).innerText.replace(/\s+/g,' ').slice(0,260)`)));
    const take = p.getByRole("button", { name: "Взять", exact: true }); const n = await take.count(); let done = false;
    for (let i = 0; i < n && !done; i++) { const card = take.nth(i); const txt = await card.evaluate((b: any) => b.closest("li,article,div")?.innerText ?? "").catch(() => ""); if (/олодильник|орозил/.test(String(txt))) { await card.click({ force: true }); done = true; } }
    if (!done && (await open.isVisible().catch(() => false))) { await open.click(); done = true; }
    await p.waitForTimeout(6000); console.log("экран задачи:", p.url().replace(s.base, ""), JSON.stringify(await p.evaluate(`(function(){var fin=Array.from(document.querySelectorAll('button')).find(function(b){return /Завершить/.test(b.innerText)});return {tempField:/Температура/.test(document.body.innerText)&&!!document.querySelector('main input'),finishDisabled:fin?fin.disabled:null,hint:(document.body.innerText.match(/Отметь[^\n]*|Заполни[^\n]*/)||[''])[0].slice(0,90)}})()`))); await p.screenshot({ path: OUT + "/claim.png", fullPage: true });
    const ret = p.getByRole("button", { name: /Вернуть задачу/ }).first(); if (await ret.isVisible().catch(() => false)) { await ret.click(); await p.waitForTimeout(800); const ok = p.getByRole("button", { name: /^Вернуть$|Да, вернуть|Вернуть задачу/ }).last(); await ok.click().catch(() => null); await p.waitForTimeout(2500); }
    await s.close(); }
})().catch((e) => { console.log("FATAL", String(e).slice(0, 300)); process.exit(1); });

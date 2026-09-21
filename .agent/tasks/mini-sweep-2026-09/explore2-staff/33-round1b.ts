import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
import { chromium } from "playwright";
const T = `document.body.innerText`;
(async () => {
  const hyg = await db.journalDocument.findFirst({ where: { organizationId: "e2e-org-a", template: { code: "hygiene" }, status: "active" }, orderBy: { createdAt: "desc" } });
  // --- тёмная тема: своя строка + главная кнопка
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "dark" });
  const p = s.page;
  await p.goto(s.base + `/journals/hygiene/documents/${hyg!.id}`, { timeout: 300000 }); await sleep(p, 12000);
  await shot(p, "33-hyg-dark");
  const r = await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^Заполнить: /.test(b.innerText.trim()));return b?(b.click(),'клик: '+b.innerText.trim()):'нет главной кнопки';})()`);
  console.log("главная кнопка (тёмная):", r); await sleep(p, 3000);
  await shot(p, "33-hyg-dark-sheet");
  console.log("после:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 600));
  // колокольчик → переход → прокрутка
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 6000);
  const bell = await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('header button, button')].find(b=>/bell|Bell/.test(b.innerHTML)||b.getAttribute('aria-label')==='Уведомления');return b?(b.click(),'клик по колокольчику'):'нет колокольчика';})()`);
  console.log("колокольчик:", bell); await sleep(p, 2500);
  await shot(p, "33-bell-dark");
  await p.evaluate(`(()=>{const a=document.querySelector('a[href="/mini/sections"]');a&&a.click();})()`);
  await sleep(p, 5000);
  const sc = await p.evaluate(`(()=>{const b=document.body,h=document.documentElement;window.scrollTo(0,400);return {y:window.scrollY,bodyOverflow:getComputedStyle(b).overflow,htmlOverflow:getComputedStyle(h).overflow,pos:getComputedStyle(b).position};})()`);
  console.log("после перехода прокрутка:", JSON.stringify(sc));
  await shot(p, "33-after-bell-nav");
  // 404 в тёмной теме
  await p.goto(s.base + "/mini/nope-zz3", { timeout: 300000 }).catch(()=>null); await sleep(p, 5000);
  await shot(p, "33-404-dark");
  console.log("404:", ((await p.evaluate(T).catch(()=>"?")) as string).replace(/\n+/g," | ").slice(0, 300));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();

  // --- без входа
  const br = await chromium.launch({ headless: true });
  const ctx = await br.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
  const np = await ctx.newPage();
  for (const u of ["/mini/me", "/mini/today", "/mini/outbox"]) {
    await np.goto("http://localhost:3021" + u, { timeout: 300000 }).catch(()=>null);
    await np.waitForTimeout(6000);
    console.log(`без входа ${u} → ${np.url().replace("http://localhost:3021","")} :: ` + ((await np.evaluate(T).catch(()=>"?")) as string).replace(/\n+/g," | ").slice(0, 250));
    await np.screenshot({ path: "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore2-staff/33-noauth" + u.replace(/\//g,"-") + ".png" });
  }
  await br.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });

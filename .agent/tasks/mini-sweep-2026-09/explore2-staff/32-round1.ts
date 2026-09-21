import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
import { claimScope, releaseActive } from "./claimlib";
const T = `document.body.innerText`;
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  // --- A. замок «Взять» при активной задаче
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 6000);
  await releaseActive(p);
  await claimScope(p, "climate_control", "");
  await p.reload({ timeout: 300000 }); await sleep(p, 6000);
  const locked = await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].filter(b=>/Взять/.test(b.innerText));const l=b.find(x=>x.disabled||/lock|Lock/.test(x.innerHTML));return {всего:b.length,первый:{txt:b[0]?.innerText.trim(),dis:b[0]?.disabled,title:b[0]?.getAttribute('title')}};})()`);
  console.log("A) кнопки «Взять» при активной задаче:", JSON.stringify(locked));
  await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].filter(b=>/Взять/.test(b.innerText));b[0]&&b[0].click();})()`);
  await sleep(p, 2500);
  await shot(p, "32-lock-take");
  console.log("A) после тапа по замку:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 400));

  // --- B. главная кнопка «Заполнить: Имя» на гигиене
  const hyg = await db.journalDocument.findFirst({ where: { organizationId: "e2e-org-a", template: { code: "hygiene" }, status: "active" }, orderBy: { createdAt: "desc" } });
  await p.goto(s.base + `/journals/hygiene/documents/${hyg!.id}`, { timeout: 300000 }); await sleep(p, 10000);
  await shot(p, "32-hygiene-doc");
  const main = await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>60&&r.height>30}).map(e=>e.innerText.replace(/\s+/g,' ').trim()).filter(Boolean);return b.slice(0,20);})()`);
  console.log("B) крупные кнопки бланка гигиены:", JSON.stringify(main));
  const fill = await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^Заполнить/.test(b.innerText.trim()));return b?(b.click(),'клик: '+b.innerText.trim()):'нет кнопки «Заполнить»';})()`);
  console.log("B) главная кнопка:", fill); await sleep(p, 2500);
  await shot(p, "32-fill-sheet");
  console.log("B) после нажатия:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 600));

  // --- C. заблокированная ячейка прошлого дня
  await p.evaluate(`document.querySelectorAll('[role=dialog] button[aria-label], [data-state=open] button').forEach(b=>{if(/Закрыть|Отмена/.test(b.innerText||b.getAttribute('aria-label')||''))b.click()})`).catch(()=>null);
  await sleep(p, 1500);
  const cell = await p.evaluate(String.raw`(()=>{const c=[...document.querySelectorAll('button,td,div')].filter(e=>{const t=(e.getAttribute('title')||e.getAttribute('aria-label')||'');return /прошл|закрыт|нельзя|Прошедш/i.test(t)});return c.slice(0,3).map(e=>({t:e.tagName,title:e.getAttribute('title')||e.getAttribute('aria-label')}));})()`);
  console.log("C) ячейки с пояснением:", JSON.stringify(cell));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });

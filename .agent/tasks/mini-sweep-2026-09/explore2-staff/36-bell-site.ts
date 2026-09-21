import { openTelegramSession } from "../tg-session";
import { shot, sleep } from "./lib";
const BELL = String.raw`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Уведомления'||/lucide-bell/.test(b.innerHTML));return b?(b.click(),'клик'):'нет';})()`;
const PROBE = String.raw`(()=>{const e=[...document.querySelectorAll('div')].find(e=>/fixed inset-0 z-40/.test(e.className+''));if(!e)return 'нет подложки';const r=e.getBoundingClientRect();const p=e.firstElementChild;const pr=p.getBoundingClientRect();return {подложка:[Math.round(r.width),Math.round(r.height)],панель:[Math.round(pr.x),Math.round(pr.y),Math.round(pr.width),Math.round(pr.height)],zПанели:getComputedStyle(p).zIndex,окно:[innerWidth,innerHeight]};})()`;
(async () => {
  const s = await openTelegramSession({ role: "managerA", width: 1280, height: 900, theme: "light" });
  const p = s.page;
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.goto(s.base + "/dashboard", { timeout: 300000 }); await sleep(p, 10000);
  console.log("сайт 1280:", await p.evaluate(BELL)); await sleep(p, 2500);
  console.log(JSON.stringify(await p.evaluate(PROBE)));
  await shot(p, "36-bell-site-1280");
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });

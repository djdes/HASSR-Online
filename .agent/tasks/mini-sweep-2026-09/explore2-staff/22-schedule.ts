import { openTelegramSession, db, state } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
const BTNS = String.raw`(()=>[...document.querySelectorAll('button,select,a[href]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}).map(e=>({tag:e.tagName,t:(e.innerText||'').replace(/[\n\t]+/g,' ').trim().slice(0,40),h:e.getAttribute('href')})))()`;
(async () => {
  const s = await openTelegramSession({ role: "managerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  console.log("дом управляющей:", p.url());
  await p.goto(s.base + "/settings/schedule", { timeout: 300000 }); await sleep(p, 9000);
  await shot(p, "22-schedule", true);
  console.log("=== график ===\n" + ((await p.evaluate(T)) as string).slice(0, 2000));
  console.log("\n=== контролы ===", JSON.stringify(await p.evaluate(BTNS)).slice(0, 2500));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,10)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });

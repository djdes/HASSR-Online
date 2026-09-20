import { openTelegramSession, db, state } from "../tg-session";
import { shot } from "./lib";
const PROBE = `(()=>{const m=document.getElementById('mini-root');return {body:getComputedStyle(document.body).backgroundColor, mt:m?m.getAttribute('data-theme'):'-', app:document.documentElement.getAttribute('data-app-theme'), ls:localStorage.getItem('wesetup-app-theme'), mode:localStorage.getItem('wesetup-theme-mode')}})()`;
(async () => {
  // профиль = тёмная, клиент Telegram = светлый
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  await db.user.update({ where: { id: state.users.cookA.id }, data: { themePreference: "dark" } });
  const p = s.page;
  await p.goto(s.base + "/mini/me", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(5000);
  await p.getByText("Тёмная", { exact: true }).click();
  await p.waitForTimeout(2500);
  console.log("1 me after dark", JSON.stringify(await p.evaluate(PROBE)));
  await p.goto(s.base + "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(9000);
  console.log("2 doc", JSON.stringify(await p.evaluate(PROBE)));
  await shot(p, "confirm-doc-light-in-dark");
  await p.goto(s.base + "/mini/today", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(8000);
  console.log("3 back to today", JSON.stringify(await p.evaluate(PROBE)));
  await shot(p, "confirm-today-after-doc");
  await p.goto(s.base + "/mini/me", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(5000);
  console.log("4 me again", JSON.stringify(await p.evaluate(PROBE)));
  console.log("switch shows:", await p.evaluate(`[...document.querySelectorAll('button')].filter(b=>/Тёмная|Светлая/.test(b.innerText)).map(b=>b.innerText.trim()+':'+b.getAttribute('aria-pressed')).join(', ')`));
  await shot(p, "confirm-me-after-doc");
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });

import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
const OPEN = `[...document.querySelectorAll("div.fixed.inset-0")].filter(d=>/Уведомления/.test(d.innerText)).length`;
(async () => {
for (const theme of ["light","dark"] as const) {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme });
  const p = s.page;
  await go(p, s.base + "/dashboard", 5000);
  await p.waitForTimeout(7000);
  console.log("=== theme", theme, "===");
  // 1. Escape
  await p.click('button[aria-label="Уведомления"]');
  await p.waitForTimeout(1500);
  console.log("opened:", await p.evaluate(OPEN));
  await shot(p, `31-bell-${theme}-open`);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1200);
  console.log("after Escape open count:", await p.evaluate(OPEN));
  // 2. тап мимо (в подложку внизу)
  await p.evaluate(`(()=>{const o=document.querySelector('div.fixed.inset-0');o.dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`);
  await p.waitForTimeout(1200);
  console.log("after tap-outside open count:", await p.evaluate(OPEN));
  // 3. снова открыть и перейти по ссылке
  await p.click('button[aria-label="Уведомления"]');
  await p.waitForTimeout(1500);
  console.log("reopened:", await p.evaluate(OPEN));
  await shot(p, `31-bell-${theme}-open2`);
  await go(p, s.base + "/journals", 4000);
  await p.waitForTimeout(3000);
  console.log("after navigation open count:", await p.evaluate(OPEN));
  await s.close();
}
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });

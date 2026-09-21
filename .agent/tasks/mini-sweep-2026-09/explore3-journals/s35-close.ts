import { openTelegramSession, SHOT, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const id = ZZ["accident_journal"][0].id;
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  await s.page.goto(`${s.base}/journals/accident_journal/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(6000);
  // open "..." menu
  const more = s.page.locator('button').filter({ hasText: /^$/ });
  const menuBtns = await s.page.evaluate(`Array.from(document.querySelectorAll('button')).map(function(e,i){return i+':'+(e.getAttribute('aria-label')||'')+'|'+(e.textContent||'').trim().slice(0,25)}).slice(0,25)`);
  console.log("buttons:", JSON.stringify(menuBtns));
  const dots = s.page.locator('button[aria-haspopup], button[aria-label*="ейств"], button[aria-label*="Ещ"]').first();
  if (await dots.count()) { await dots.click().catch(() => null); await s.page.waitForTimeout(2000); }
  const menu = await s.page.evaluate(`(function(){var m=document.querySelector('[role="menu"],[role="dialog"]'); return m? m.innerText.slice(0,600):'no menu: '+document.body.innerText.slice(0,300)})()`);
  console.log("menu:", String(menu).replace(/\n/g, " | "));
  await s.page.screenshot({ path: SHOT + "/close-menu.png" });
  await s.close();
})();

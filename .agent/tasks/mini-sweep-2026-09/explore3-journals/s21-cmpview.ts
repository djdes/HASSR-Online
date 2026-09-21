import { openTelegramSession, SHOT, out, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const id = ZZ["complaint_register"][0].id;
  await s.page.goto(`${s.base}/journals/complaint_register/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(5500);
  await s.page.screenshot({ path: SHOT + "/cmp-view-cards.png", fullPage: true });
  const cardsTxt = await s.page.evaluate(`document.body.innerText.slice(0,2000)`);
  console.log("CARDS:", cardsTxt);
  const over1 = await s.page.evaluate(`(function(){var o=[];document.querySelectorAll('body *').forEach(function(e){if(e.children.length)return;var b=e.getBoundingClientRect();if(b.width>0&&b.right>361.5){var p=e,ok=false;while(p&&p!==document.body){if(/auto|scroll/.test(getComputedStyle(p).overflowX)){ok=true;break;}p=p.parentElement;}if(!ok)o.push(e.tagName+':'+(e.textContent||'').trim().slice(0,30)+' r='+Math.round(b.right));}});return o.slice(0,6);})()`);
  console.log("cards overflow:", over1);
  await s.page.locator('button:has-text("Таблица")').first().click();
  await s.page.waitForTimeout(3500);
  await s.page.screenshot({ path: SHOT + "/cmp-view-table.png", fullPage: true });
  const t = await s.page.evaluate(`(function(){var tb=document.querySelector('table'); return tb? tb.innerText.slice(0,2500):'no table'})()`);
  console.log("TABLE:", t);
  // PDF
  const pdf = await s.page.evaluate(`fetch('/api/journal-documents/${id}/pdf').then(function(r){return r.status+' '+r.headers.get('content-type')+' len='+r.headers.get('content-length')}).catch(function(e){return 'err '+e})`);
  console.log("PDF:", pdf);
  await s.close();
})();

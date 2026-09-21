import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES, FIELDS, dump } from "./lib";
import { chromium } from "playwright";
import fs from "node:fs";

const TAG = "ZZ2";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  let joinUrl = "";
  page.on("response", async (r) => {
    if (r.url().includes("/api/staff/join-token") && r.request().method() === "POST") {
      try { const j = await r.json(); joinUrl = j.joinUrl; console.log("JOIN-RESP", JSON.stringify({ joinUrl: j.joinUrl, expiresAt: j.expiresAt, id: j.id })); } catch (e) { console.log("resp parse", String(e)); }
    }
  });
  await go(page, s.base + "/settings/users", 5000);
  await page.getByRole("button", { name: "Пригласить по QR" }).click();
  await page.waitForTimeout(1200);
  // выберем должность-подсказку "Повар"
  const sel = page.locator("select").first();
  const opts = await page.evaluate(`[...document.querySelectorAll('select option')].map(o=>o.value+'|'+o.textContent)`);
  console.log("POSITION-OPTS", JSON.stringify(opts));
  await page.locator("input[placeholder*='Иванов']").fill(TAG + " метка QR");
  const wait = page.waitForResponse((r:any)=>r.url().includes("/api/staff/join-token"), { timeout: 180000 }).catch((e:any)=>{console.log("no resp", String(e).slice(0,100)); return null;});
  await page.getByRole("button", { name: /Сгенерировать/ }).click();
  await wait;
  await page.waitForTimeout(3000);
  await shot(page, "04-qr-generated");
  const t = await page.evaluate(`document.body.innerText.slice(-1200)`);
  console.log("AFTER-GEN-TEXT", t);
  const c: string[] = await page.evaluate(CLICKABLES);
  console.log("AFTER-GEN-CLICK", JSON.stringify(c.slice(0,40), null, 1));
  // геометрия окна после генерации (стало длиннее?)
  const geo = await page.evaluate(`(() => { const o=[...document.querySelectorAll('div')].filter(e=>getComputedStyle(e).position==='fixed'&&e.getBoundingClientRect().height>100); const card=document.querySelector('div.fixed.inset-0 > *'); const r=card?card.getBoundingClientRect():null; return { win:{w:innerWidth,h:innerHeight}, card: r?{t:Math.round(r.top),b:Math.round(r.bottom),h:Math.round(r.height)}:null }; })()`);
  console.log("GEO-AFTER-GEN", JSON.stringify(geo));
  fs.writeFileSync("C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore2-owner/joinurl.txt", joinUrl || "NONE");
  console.log("JOINURL=", joinUrl);
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,10)));
  await s.close();
})();

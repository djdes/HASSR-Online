import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
const UID = "cmuagc7we00q8cc9m9xkg98zx";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  await go(page, `${s.base}/settings/users/${UID}/access`, 7000);
  const row = page.locator("table tbody tr").first();
  await row.locator("button").nth(0).click();
  await page.waitForTimeout(300);
  await page.evaluate(`document.querySelector('div.overflow-x-auto').scrollLeft = 300`);
  await row.locator("button").nth(1).click();
  await page.waitForTimeout(300);
  // прокрутим до кнопки Сохранить и посмотрим, что сверху
  await page.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
  await page.waitForTimeout(800);
  await shot(page, "15-save-area");
  const info = await page.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Сохранить');
    if(!b) return 'no button';
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    const top = document.elementFromPoint(cx, cy);
    return { rect: {t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)}, win:{w:innerWidth,h:innerHeight}, topEl: top ? top.tagName+'.'+String(top.className).slice(0,80) : null, isSelf: top===b || b.contains(top), disabled: b.disabled };
  })()`);
  console.log("SAVE-BTN", JSON.stringify(info, null, 1));
  const wait = page.waitForResponse((r:any)=>r.request().method()!=="GET"&&r.url().includes("/api"), { timeout: 90000 }).catch(()=>null);
  await page.evaluate(`[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Сохранить').click()`);
  const rr = await wait;
  if (rr) console.log("SAVE-RESP", rr.status(), rr.request().method(), rr.url().slice(-70), (await rr.text().catch(()=> "")).slice(0,200));
  else console.log("SAVE-RESP none");
  await page.waitForTimeout(3000);
  await shot(page, "15-after-save");
  const rows = await db.userJournalAccess.findMany({ where: { userId: UID } });
  console.log("DB-ACL", JSON.stringify(rows.map((r:any)=>({ t:r.templateCode ?? r.journalCode ?? r.templateId, ...r })).slice(0,4), null, 1));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();

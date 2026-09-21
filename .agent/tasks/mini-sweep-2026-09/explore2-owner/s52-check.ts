import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
(async () => {
  console.log("ORG", JSON.stringify(await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { disabledJournalCodes: true } })));
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, s.base + "/journals", 9000);
    const t = (await page.evaluate(`document.body.innerText`) as string);
    const idx = t.indexOf("металлопримес");
    console.log("НАЙДЕНО?", idx >= 0, idx >= 0 ? JSON.stringify(t.slice(Math.max(0,idx-200), idx+200)) : "");
    console.log("ссылка есть?", await page.evaluate(`!!document.querySelector('a[href*="metal_impurity"]')`));
    await page.evaluate(`(() => { const a=document.querySelector('a[href*="metal_impurity"]'); if(a) a.scrollIntoView({block:'center'}); })()`);
    await page.waitForTimeout(600);
    await shot(page, "52-journals-disabled");
    console.log("HEADER", (t.match(/Сегодня[^\n]*/g)||[]).slice(0,3));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  await s.close();
})();

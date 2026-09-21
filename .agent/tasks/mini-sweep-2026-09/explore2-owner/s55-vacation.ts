import { openTelegramSession, db } from "../tg-session";
import { shot, go, FIELDS, CLICKABLES } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, s.base + "/settings/users", 8000);
    await page.evaluate(`{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='График отпусков'); b.scrollIntoView({block:'center'}); b.click();}`);
    await page.waitForTimeout(2500);
    await page.evaluate(`{const bs=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='Добавить'); bs[bs.length-1].click();}`);
    await page.waitForTimeout(2500);
    await shot(page, "55-vac-add", true);
    console.log("FIELDS", JSON.stringify(await page.evaluate(FIELDS), null, 1));
    console.log("SELECTS", JSON.stringify(await page.evaluate(`[...document.querySelectorAll('select')].map(s=>[...s.options].map(o=>o.text).join(' / ').slice(0,200))`), null, 1));
    console.log("TAIL", (await page.evaluate(`document.body.innerText`) as string).slice(-800));
    console.log("CLICK", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).filter(x=>!x.includes("->/")).slice(-12), null, 1));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,6)));
  await s.close();
})();

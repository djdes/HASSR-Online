import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  let native: string[] = [];
  page.on("dialog", async d => { native.push(d.type()+":"+d.message().slice(0,80)); await d.dismiss(); });
  const dlgGeo = async (tag: string) => {
    const r = await page.evaluate(`(() => { const ov=[...document.querySelectorAll('*')].filter(e=>{const cs=getComputedStyle(e); const rr=e.getBoundingClientRect(); return cs.position==='fixed' && rr.height>100 && rr.width>100;}).map(e=>{const rr=e.getBoundingClientRect(); return String(e.className).slice(0,50)+' z='+getComputedStyle(e).zIndex+' '+Math.round(rr.width)+'x'+Math.round(rr.height)+' @'+Math.round(rr.top)+' par='+e.parentElement.tagName; }); const btns=[...document.querySelectorAll('button')].filter(b=>/Да,|Отозв|Подтверд|Завершить|Удалить/i.test(b.innerText)).map(b=>{const rr=b.getBoundingClientRect(); const top=document.elementFromPoint(rr.left+rr.width/2, rr.top+rr.height/2); return JSON.stringify(b.innerText.trim())+' @'+Math.round(rr.top)+' clickable='+(top===b||b.contains(top));}); return { win: innerHeight, ov, btns }; })()`);
    console.log(tag, JSON.stringify(r, null, 1));
  };
  try {
    // A) отзыв API-ключа
    await go(page, s.base + "/settings/api", 8000);
    await page.getByRole("button", { name: "Отозвать" }).click();
    await page.waitForTimeout(3500);
    await shot(page, "44-revoke");
    console.log("REVOKE-TEXT", (await page.evaluate(`document.body.innerText`) as string).slice(-700));
    await dlgGeo("REVOKE-GEO");
    console.log("NATIVE", JSON.stringify(native));
    await page.keyboard.press("Escape"); await page.waitForTimeout(1000);
    // B) завершить все сессии
    await go(page, s.base + "/settings/security", 7000);
    console.log("SEC-BTNS", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).filter(x=>!x.includes("->/")).slice(0,10)));
    await page.evaluate(`{const b=[...document.querySelectorAll('button')].find(b=>/все сесси|всех устройств/i.test(b.innerText)); if(b) b.click();}`);
    await page.waitForTimeout(3500);
    await shot(page, "44-sessions");
    console.log("SESS-TEXT", (await page.evaluate(`document.body.innerText`) as string).slice(-700));
    await dlgGeo("SESS-GEO");
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("NATIVE-ALL", JSON.stringify(native));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,6)));
  await s.close();
})();

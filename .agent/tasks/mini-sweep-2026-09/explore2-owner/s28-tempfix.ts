import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
const DOC = "cmuaitnsh00vqcc9mjhcrizbn";
const dump = async (tag: string) => {
  const e = await db.journalDocumentEntry.findMany({ where: { documentId: DOC }, select: { id:true, employeeId:true, date:true, data:true, updatedAt:true }, orderBy: { updatedAt: "desc" }, take: 6 });
  console.log("DB " + tag, JSON.stringify(e.map(x=>({ e:String(x.employeeId).slice(-6), d: x.date.toISOString().slice(0,10), v: x.data })), null, 0));
};
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, `${s.base}/journals/cold_equipment_control/documents/${DOC}`, 10000);
    await dump("before");
    const inputs = page.locator("input[placeholder='—']");
    // 1) «−» в пустом поле -> середина нормы (для ZZ2 1..5 => 3)
    await page.evaluate(`[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Уменьшить').click()`);
    await page.waitForTimeout(2500);
    console.log("A) after minus, field =", JSON.stringify(await inputs.nth(0).inputValue()));
    await shot(page, "28-a-minus");
    await dump("after-minus");
    // 2) Enter сохраняет
    await inputs.nth(1).click(); await inputs.nth(1).fill("-20");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    console.log("B) freezer field =", JSON.stringify(await inputs.nth(1).inputValue()));
    await dump("after-enter");
    // 3) 44 °C вне допустимого
    await inputs.nth(2).click(); await inputs.nth(2).fill("44");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    await shot(page, "28-c-44");
    console.log("C) field =", JSON.stringify(await inputs.nth(2).inputValue()));
    console.log("C) page tail =", (await page.evaluate(`document.body.innerText`) as string).slice(-700));
    await dump("after-44");
    // 4) вне нормы, но допустимо: 20 для холодильника 2..6
    await inputs.nth(3).click(); await inputs.nth(3).fill("20");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);
    await shot(page, "28-d-20", true);
    await dump("after-20");
    console.log("D) page =", (await page.evaluate(`document.body.innerText`) as string).slice(0, 1400));
  } catch (e) { console.log("ERR", String(e).slice(0,400)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,10), null, 1));
  await s.close();
})();

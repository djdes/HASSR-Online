import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
const CODE = "metal_impurity";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    const org0 = await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { disabledJournalCodes: true } });
    console.log("ORG-DISABLED-BEFORE", JSON.stringify(org0));
    await go(page, `${s.base}/journals/${CODE}`, 9000);
    console.log("HEAD", (await page.evaluate(`document.body.innerText`) as string).slice(0, 500));
    const wait = page.waitForResponse((r:any)=>r.request().method()!=="GET"&&r.url().includes("/api"), { timeout: 120000 }).catch(()=>null);
    await page.evaluate(`{const b=[...document.querySelectorAll('button')].find(b=>/отключить/i.test(b.innerText)); if(b) b.click();}`);
    await page.waitForTimeout(3000);
    await shot(page, "48-disable-confirm");
    console.log("CONFIRM", (await page.evaluate(`document.body.innerText`) as string).slice(-600));
    await page.evaluate(`{const b=[...document.querySelectorAll('button')].find(b=>/Да,|Отключить|Подтвердить/i.test(b.innerText.trim())); if(b) b.click();}`);
    const rr = await wait; if (rr) console.log("RESP", rr.status(), rr.request().method(), rr.url().slice(-40));
    await page.waitForTimeout(4000);
    const org1 = await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { disabledJournalCodes: true } });
    console.log("ORG-DISABLED-AFTER", JSON.stringify(org1));
    await go(page, s.base + "/dashboard", 6000);
    const t = (await page.evaluate(`document.body.innerText`) as string);
    console.log("DASH-COUNTER", (t.match(/Есть запись за сегодня[^\n]*/)||[])[0], "| в списке металлопримеси?", t.includes("металлопримесей"));
    await shot(page, "48-dash-after", true);
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,6)));
  await s.close();
})();

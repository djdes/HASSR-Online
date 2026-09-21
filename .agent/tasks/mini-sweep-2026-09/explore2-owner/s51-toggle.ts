import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, s.base + "/settings/journals", 10000);
    const info = await page.evaluate(`(() => {
      const titles=[...document.querySelectorAll('button')].filter(b=>/металлопримес/i.test(b.innerText));
      if(!titles.length) return 'нет заголовка';
      const t=titles[0];
      const row=t.parentElement;
      const sw=[...row.querySelectorAll('button')].filter(b=>!b.innerText.trim());
      return { rowCls: String(row.className).slice(0,60), switches: sw.length, aria: sw.map(b=>b.getAttribute('aria-checked')+'/'+b.getAttribute('aria-label')+'/'+b.getAttribute('role')) };
    })()`);
    console.log("SWITCH-INFO", JSON.stringify(info));
    const wait = page.waitForResponse((r:any)=>r.request().method()!=="GET"&&r.url().includes("/api"), { timeout: 120000 }).catch(()=>null);
    await page.evaluate(`{const t=[...document.querySelectorAll('button')].filter(b=>/металлопримес/i.test(b.innerText))[0]; const sw=[...t.parentElement.querySelectorAll('button')].filter(b=>!b.innerText.trim())[0]; sw.click();}`);
    await page.waitForTimeout(2500);
    await shot(page, "51-toggle");
    console.log("MAYBE-CONFIRM", (await page.evaluate(`document.body.innerText`) as string).slice(-500));
    await page.evaluate(`{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Выключить журнал'); if(b) b.click();}`);
    const rr = await wait; if (rr) console.log("RESP", rr.status(), rr.request().method(), rr.url().slice(-45), (await rr.text().catch(()=> "")).slice(0,120));
    await page.waitForTimeout(3000);
    console.log("ORG", JSON.stringify(await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { disabledJournalCodes: true } })));
    // downstream
    await go(page, s.base + "/dashboard", 6000);
    let t = (await page.evaluate(`document.body.innerText`) as string);
    console.log("DASH", (t.match(/Есть запись за сегодня[^\n]*/)||[])[0], "| в списке?", t.includes("металлопримесей"));
    await go(page, s.base + "/journals", 5000);
    t = (await page.evaluate(`document.body.innerText`) as string);
    console.log("JOURNALS список | в списке?", t.includes("металлопримесей"), "|", (t.match(/Сегодня не требуют внимания[^\n]*/)||[])[0]);
    await go(page, `${s.base}/journals/metal_impurity`, 5000);
    console.log("ПРЯМОЙ ВХОД:", (await page.evaluate(`document.body.innerText`) as string).slice(0, 350).replace(/\n/g," | "));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,6)));
  await s.close();
})();

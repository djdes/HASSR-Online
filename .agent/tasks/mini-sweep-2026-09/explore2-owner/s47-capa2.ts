import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  const posts: string[] = [];
  page.on("response", r => { if (r.request().method()==="POST" && r.url().includes("/api")) posts.push(r.status()+" "+r.url().slice(-30)); });
  try {
    await go(page, s.base + "/capa/new", 9000);
    const dl = () => page.evaluate(`[...document.querySelectorAll('select')][3].value`);
    console.log("прио по умолчанию:", await page.evaluate(`[...document.querySelectorAll('select')][1].value`), "срок:", await dl());
    for (const p of ["critical", "high", "low", "medium"]) {
      await page.locator("select").nth(1).selectOption(p).catch(async()=>{ await page.evaluate(`{const s=[...document.querySelectorAll('select')][1]; s.value='${p}'; s.dispatchEvent(new Event('change',{bubbles:true}));}`); });
      await page.waitForTimeout(600);
      console.log("  приоритет", p, "-> срок", await dl());
    }
    // двойной тап по «Создать нарушение»
    console.log("INPUTS", JSON.stringify(await page.evaluate(`[...document.querySelectorAll('input,textarea')].map(i=>i.tagName+':'+(i.type||'')+':'+(i.placeholder||''))`)));
    await page.evaluate(`{const i=[...document.querySelectorAll('input')].filter(x=>x.type==='text'||x.type==='')[0]; const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i,'ZZ2 Двойной тап тест'); i.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await page.waitForTimeout(400);
    await page.evaluate(`{const b=[...document.querySelectorAll('button')].find(b=>/Создать нарушение/.test(b.innerText)); b.click(); b.click();}`);
    await page.waitForTimeout(9000);
    console.log("POSTS", JSON.stringify(posts));
    console.log("URL", page.url());
    await shot(page, "47-capa-after", true);
    const rows = await db.cAPA.findMany({ where: { title: { contains: "ZZ2 Двойной" } }, select: { id:true,title:true,priority:true,dueAt:true,createdAt:true } }).catch(async (e)=>{ console.log("prisma", String(e).slice(0,150)); return []; });
    console.log("DB-CAPA", JSON.stringify(rows, null, 1));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,6)));
  await s.close();
})();

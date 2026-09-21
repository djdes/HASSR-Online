import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
const HYG = "cmu3xjc390004ks9mroi7qi9i";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, s.base + "/settings/users", 8000);
    await page.evaluate(`{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='График отпусков'); b.scrollIntoView({block:'center'}); b.click();}`);
    await page.waitForTimeout(2500);
    await page.evaluate(`{const bs=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='Добавить'); bs[bs.length-1].click();}`);
    await page.waitForTimeout(2500);
    const setSel = (idx: number, label: string) => page.evaluate(`{const ss=[...document.querySelectorAll('select')]; const s=ss[ss.length-${2-idx}]; const set=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set; set.call(s, [...s.options].find(o=>o.text==='${label}').value); s.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await page.evaluate(`{const s=[...document.querySelectorAll('select')][ [...document.querySelectorAll('select')].length-1 ]; }`);
    // должность
    await page.evaluate(`{const ss=[...document.querySelectorAll('select')]; const s=ss[ss.length-1]; const set=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set; set.call(s, [...s.options].find(o=>o.text==='Повар').value); s.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await page.waitForTimeout(1800);
    // сотрудник
    await page.evaluate(`{const ss=[...document.querySelectorAll('select')]; const s=ss[ss.length-1]; const set=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set; set.call(s, [...s.options].find(o=>o.text==='ZZ2 Новичок QR').value); s.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await page.waitForTimeout(1500);
    // даты
    await page.evaluate(`{const ds=[...document.querySelectorAll('input[type=date]')]; const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(ds[0],'2026-09-21'); ds[0].dispatchEvent(new Event('input',{bubbles:true})); ds[0].dispatchEvent(new Event('change',{bubbles:true})); set.call(ds[1],'2026-09-25'); ds[1].dispatchEvent(new Event('input',{bubbles:true})); ds[1].dispatchEvent(new Event('change',{bubbles:true}));}`);
    await page.waitForTimeout(1000);
    await shot(page, "57-vac-filled");
    const w = page.waitForResponse((r:any)=>r.request().method()!=="GET"&&r.url().includes("/api"), { timeout: 120000 }).catch(()=>null);
    await page.evaluate(`{const b=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='Добавить').pop(); b.click();}`);
    const rr = await w; if (rr) console.log("SAVE", rr.status(), rr.request().method(), rr.url().slice(-45), (await rr.text().catch(()=> "")).slice(0,180));
    await page.waitForTimeout(4000);
    await shot(page, "57-vac-after", true);
    const t = (await page.evaluate(`document.body.innerText`) as string);
    const i = t.indexOf("График отпусков", t.indexOf("График отпусков")+5);
    console.log("TABLE", JSON.stringify(t.slice(i, i+600).replace(/\n/g," | ")));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  const v = await db.staffVacation.findMany({ where: {} }).catch((e:any)=>String(e).slice(0,120));
  console.log("DB-VAC", JSON.stringify(v).slice(0,600));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,6)));
  await s.close();
})();

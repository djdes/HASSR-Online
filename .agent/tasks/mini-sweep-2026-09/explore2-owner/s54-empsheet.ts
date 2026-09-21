import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES, FIELDS } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, s.base + "/settings/users", 8000);
    await page.evaluate(`(() => { const el=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='ZZ2 Новичок QR'); let p=el; for(let k=0;k<5;k++){ p=p.parentElement; const bs=[...p.querySelectorAll('button')].filter(b=>/Редактировать сотрудника/.test(b.getAttribute('aria-label')||b.title||'')); if(bs.length){ bs[0].click(); return; } } })()`);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore2-owner/54-sheet.png" });
    console.log("FIELDS", JSON.stringify(await page.evaluate(FIELDS), null, 1));
    const chips = await page.evaluate(`[...document.querySelectorAll('button')].filter(b=>/^(Пн|Вт|Ср|Чт|Пт|Сб|Вс)$/.test(b.innerText.trim())).map(b=>{const r=b.getBoundingClientRect(); return b.innerText.trim()+' @'+Math.round(r.left)+'-'+Math.round(r.right)+' top='+Math.round(r.top);})`);
    console.log("CHIPS", JSON.stringify(chips));
    console.log("SHEET-OVERFLOW", await page.evaluate(`(() => { const sh=[...document.querySelectorAll('*')].find(e=>/Редактировать:/.test(e.innerText||'')&&getComputedStyle(e).position==='fixed'); if(!sh) return 'нет'; const r=sh.getBoundingClientRect(); return {t:Math.round(r.top),b:Math.round(r.bottom),sh:sh.scrollHeight,ch:sh.clientHeight,win:innerHeight}; })()`));
    // теперь — вкладки графиков
    await page.keyboard.press("Escape"); await page.waitForTimeout(1500);
    for (const tab of ["График отпусков", "График больничных", "График увольнений"]) {
      await page.evaluate(`{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='${tab}'); if(b){b.scrollIntoView({block:'center'}); b.click();}}`);
      await page.waitForTimeout(2500);
      await shot(page, "54-" + tab.replace(/\s/g, "_"));
      const t = (await page.evaluate(`document.body.innerText`) as string);
      const i = t.indexOf(tab);
      console.log("== " + tab, JSON.stringify(t.slice(i, i + 700).replace(/\n/g, " | ")));
    }
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,6)));
  await s.close();
})();

import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES } from "./lib";

(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  await go(page, s.base + "/settings/users", 6000);
  const has = await page.evaluate(`document.body.innerText.includes("ZZ2 Новичок QR")`);
  console.log("SEES-NEW-USER", has);
  // раскроем должность Повар
  const around = await page.evaluate(`(() => {
    const nl=String.fromCharCode(10);
    const el=[...document.querySelectorAll('*')].find(e=>e.children.length===0 && e.textContent.trim()==='ZZ2 Новичок QR');
    if(!el) return 'not found';
    let p=el; for(let i=0;i<5;i++){ if(p.parentElement) p=p.parentElement; }
    return p.innerText.split(nl).join(' | ').slice(0,600);
  })()`);
  console.log("ROW", around);
  // прокрутить к нему
  await page.evaluate(`(() => { const el=[...document.querySelectorAll('*')].find(e=>e.children.length===0 && e.textContent.trim()==='ZZ2 Новичок QR'); if(el) el.scrollIntoView({block:'center'}); })()`);
  await page.waitForTimeout(700);
  await shot(page, "07-user-row");
  const acc = await db.userJournalAccess.count({ where: { userId: (await db.user.findFirst({ where: { name: "ZZ2 Новичок QR" }, select: { id: true } }))!.id } });
  console.log("DB-JOURNAL-ACCESS-ROWS", acc);
  const u = await db.user.findFirst({ where: { name: "ZZ2 Новичок QR" }, select: { id:true, journalAccessMigrated:true, permissionPreset:true } });
  console.log("DB-U", JSON.stringify(u));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();

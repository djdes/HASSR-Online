import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  const probe = async (tag: string) => {
    const r = await page.evaluate(`(() => { const fx=[...document.querySelectorAll('*')].filter(e=>{const cs=getComputedStyle(e); const r=e.getBoundingClientRect(); return (cs.position==='fixed'||cs.position==='absolute') && r.height>120 && cs.opacity!=='0' && cs.visibility!=='hidden';}).map(e=>{const r=e.getBoundingClientRect(); return String(e.className).slice(0,45)+' z='+getComputedStyle(e).zIndex+' t='+Math.round(r.top)+' h='+Math.round(r.height)+' :: '+(e.innerText||'').split(String.fromCharCode(10)).join(' ').slice(0,60);}); return fx.slice(0,8); })()`);
    console.log(tag, JSON.stringify(r, null, 1));
  };
  try {
    for (const u of ["/dashboard", "/journals", "/settings"]) {
      await go(page, s.base + u, 6000);
      await page.getByRole("button", { name: "Уведомления" }).click();
      await page.waitForTimeout(3500);
      await shot(page, "39-bell" + u.replace(/\//g, "_"));
      await probe("AFTER-BELL " + u);
      const body = (await page.evaluate(`document.body.innerText`) as string);
      console.log("  has-notif-words:", /Уведомлен|Очистить|Пока пусто|новых|прочитан/i.test(body));
    }
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8), null, 1));
  await s.close();
})();

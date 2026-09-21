import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
(async () => {
const users = await db.user.findMany({ where: { organizationId: "e2e-org-a", role: "cook" }, select: { id: true, name: true }, take: 3 });
console.log("users", JSON.stringify(users));
const uid = users[0].id;
for (const theme of ["light","dark"] as const) {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme });
  const p = s.page;
  for (const [name, url] of [["access", `/settings/users/${uid}/access`], ["equipment", "/settings/equipment"], ["periods", "/settings/journal-periods"]] as const) {
    await go(p, s.base + url, 5000);
    await p.waitForTimeout(7000);
    const pr = await probe(p);
    console.log(`--- ${name} ${theme} --- overflow=${pr.overflow} url=${pr.url}`);
    console.log(pr.bodyText.slice(0,400).replace(/\n/g," | "));
    await shot(p, `34-${name}-${theme}-a`);
    // прокрутить таблицу вправо
    const info = await p.evaluate(`(()=>{const t=[...document.querySelectorAll('table')];if(!t.length)return 'no table';const w=t[0].closest('div');const sc=(function f(e){for(;e;e=e.parentElement){if(e.scrollWidth>e.clientWidth+5)return e;}return null})(t[0]);if(!sc)return 'no scroller';sc.scrollLeft=sc.scrollWidth;const th=t[0].querySelector('thead th');const cs=th?getComputedStyle(th):null;return JSON.stringify({scrolled:sc.scrollLeft,sw:sc.scrollWidth,cw:sc.clientWidth,firstTh:th?th.innerText.slice(0,30):null,pos:cs?cs.position:null,left:cs?cs.left:null,bg:cs?cs.backgroundColor:null,z:cs?cs.zIndex:null});})()`);
    console.log("scroll:", info);
    await p.waitForTimeout(900);
    await shot(p, `34-${name}-${theme}-b`);
  }
  await s.close();
}
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });

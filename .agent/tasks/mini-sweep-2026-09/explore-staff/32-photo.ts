import { openTelegramSession, db, state } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const c = await db.journalTaskClaim.findFirst({ where: { userId: state.users.cleanerA.id, status: "active" } });
  const s = await openTelegramSession({ role: "cleanerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/claim/" + c!.id, { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(8000);
  for (let i = 0; i < 12; i++) { await p.evaluate(`document.querySelectorAll('input[type=checkbox]')[${i}].scrollIntoView({block:'center'})`); await p.waitForTimeout(200); await p.locator("input[type=checkbox]").nth(i).click({ force: true, timeout: 8000 }).catch(() => {}); }
  await p.waitForTimeout(1200);
  console.log("checked", await p.locator("input[type=checkbox]:checked").count());
  console.log("SUBMIT:", await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Завершить|Нужно фото/.test(b.innerText));return b? b.innerText.replace(/\s+/g,' ')+' | disabled='+b.disabled:'none'})()`));
  // photo
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Снять фото/.test(b.innerText)); if(b) b.scrollIntoView({block:'center'})})()`);
  await p.waitForTimeout(600);
  await shot(p, "photo-step-view");
  await p.getByRole("button", { name: /Снять фото/ }).click({ timeout: 10000 }).catch((e) => console.log("photo click err", String(e).slice(0, 80)));
  await p.waitForTimeout(3500);
  console.log("after photo click url", p.url());
  console.log("TAIL", (await T(p)).slice(-400));
  await shot(p, "photo-after-click");
  console.log("file inputs", await p.locator("input[type=file]").count());
  console.log("tg popups", JSON.stringify(await p.evaluate(`window.__tgHost.popups`)));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });

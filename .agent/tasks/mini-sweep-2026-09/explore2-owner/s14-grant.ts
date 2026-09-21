import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
const UID = "cmuagc7we00q8cc9m9xkg98zx";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  await go(page, `${s.base}/settings/users/${UID}/access`, 7000);
  // строка "Гигиенический журнал": отметим Просмотр и Заполнение
  const row = page.locator("table tbody tr").first();
  console.log("row text", (await row.innerText()).replace(/\n/g, " | "));
  const boxes = row.locator("button");
  console.log("boxes count", await boxes.count());
  await boxes.nth(0).click();
  await page.waitForTimeout(300);
  // прокрутим контейнер чтобы добраться до "Заполнение"
  await page.evaluate(`document.querySelector('div.overflow-x-auto').scrollLeft = 300`);
  await page.waitForTimeout(400);
  await shot(page, "14-access-hscroll");
  await boxes.nth(1).click();
  await page.waitForTimeout(400);
  await shot(page, "14-access-checked");
  const wait = page.waitForResponse((r:any)=>r.request().method()!=="GET" && r.url().includes("/api"), { timeout: 120000 }).catch(()=>null);
  await page.getByRole("button", { name: "Сохранить" }).click();
  const rr = await wait;
  if (rr) console.log("SAVE", rr.status(), rr.url().slice(-60), (await rr.text().catch(()=> "")).slice(0,200));
  await page.waitForTimeout(3000);
  await shot(page, "14-after-save");
  console.log("TOAST", await page.evaluate(`[...document.querySelectorAll('[data-sonner-toast],li')].map(e=>e.innerText).filter(Boolean).slice(0,5).join(' // ')`));
  const rows = await db.userJournalAccess.findMany({ where: { userId: UID }, select: { templateCode: true, canView: true, canWrite: true, canFinalize: true } }).catch(async (e) => { console.log("ERR", String(e).slice(0,200)); return []; });
  console.log("DB-ACL", JSON.stringify(rows, null, 1));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();

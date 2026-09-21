import { openTelegramSession, SHOT, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const id = ZZ["cold_equipment_control"][0].id;
const today = "2026-09-21";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const read = async () => { const e = await db.journalDocumentEntry.findFirst({ where: { documentId: id, date: new Date(today + "T00:00:00.000Z") }, select: { data: true } }); return JSON.stringify((e?.data as any)?.temperatures); };
  const open = async () => { await s.page.goto(`${s.base}/journals/cold_equipment_control/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" }); await s.page.waitForTimeout(8000); };
  // 1. Enter key commit
  await open();
  const inp = () => s.page.locator('input').nth(2);
  await inp().click(); await inp().fill(""); await inp().type("3", { delay: 60 });
  await s.page.keyboard.press("Enter");
  await s.page.waitForTimeout(3000);
  console.log("after Enter (no blur), db:", await read());
  // 2. letters erase
  await open();
  console.log("start db:", await read());
  await inp().click(); await inp().type("abc", { delay: 80 });
  await s.page.waitForTimeout(500);
  const v = await s.page.evaluate(`(document.querySelectorAll('input')[2]||{}).value`);
  await s.page.locator('h1').first().click({ force: true }).catch(() => null);
  await s.page.waitForTimeout(3000);
  console.log("typed abc -> input value:", JSON.stringify(v), "db:", await read());
  await s.page.screenshot({ path: SHOT + "/temp-abc.png" });
  const body = await s.page.evaluate(`document.body.innerText.slice(0,400)`);
  console.log("body:", String(body).replace(/\n/g, " | "));
  await s.close();
})();

import { chromium } from "playwright";
import fs from "node:fs";
import { shot, go, probe, FIELDS } from "./lib";
import { db } from "../tg-session";

const SHOTDIR = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore2-owner";
const NAME = "ZZ2 Новичок QR";
const PHONE_TYPED = "+7 921 000 77 88";
const PASS = "Zz2Test2026!";
(async () => {
  const joinUrl = fs.readFileSync(SHOTDIR + "/joinurl.txt", "utf8").trim();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push("pageerror " + String(e).slice(0, 150)));
  page.on("response", async (r) => { if (r.status() >= 400 && !/_next\/static|favicon/.test(r.url())) errs.push(`http ${r.status()} ${r.request().method()} ${r.url().slice(-70)} ${(await r.text().catch(()=> "")).slice(0,200)}`); });
  await go(page, joinUrl, 4000);
  await page.getByRole("button", { name: "ОК" }).click().catch(()=>{});
  await page.waitForTimeout(500);
  await page.locator("input[type=text]").first().fill(NAME);
  // Телефон: печатаем по-человечески поверх подставленного +7
  const tel = page.locator("input[type=tel]").first();
  await tel.click();
  await page.keyboard.type(PHONE_TYPED, { delay: 40 });
  const telVal = await tel.inputValue();
  console.log("PHONE-FIELD-AFTER-TYPE", JSON.stringify(telVal));
  // должность = Повар
  await page.locator("select").first().selectOption({ label: "Повар" });
  await page.locator("input[type=password]").first().fill(PASS);
  await shot(page, "06-join-filled", true);
  const wait = page.waitForResponse((r:any)=>r.url().includes("/api/") && r.request().method()==="POST", { timeout: 180000 }).catch(()=>null);
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  const resp = await wait;
  if (resp) console.log("SUBMIT", resp.status(), resp.url().slice(-60), (await resp.text().catch(()=> "")).slice(0,300));
  await page.waitForTimeout(6000);
  console.log("URL-AFTER", page.url());
  await shot(page, "06-join-after", true);
  console.log("TEXT", (await page.evaluate(`document.body.innerText.slice(0,1500)`)));
  console.log("ERRS", JSON.stringify(errs, null, 1));
  // --- DB
  const u = await db.user.findFirst({ where: { name: { contains: "ZZ2 Новичок" } }, select: { id:true,name:true,email:true,phone:true,role:true,jobPositionId:true,organizationId:true,isActive:true, archivedAt:true } });
  console.log("DB-USER", JSON.stringify(u, null, 1));
  if (u?.jobPositionId) console.log("DB-POS", JSON.stringify(await db.jobPosition.findUnique({ where: { id: u.jobPositionId }, select: { title:true } })));
  fs.writeFileSync(SHOTDIR + "/zz2user.json", JSON.stringify(u ?? {}, null, 1));
  await browser.close();
  await db.$disconnect();
})();

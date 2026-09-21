import { chromium } from "playwright";
import { db } from "../tg-session";
import { shot, go, FIELDS, CLICKABLES } from "./lib";
const PASS = "Zz2Test2026!";
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  // A) /login с телефоном как «email»
  await go(page, "http://localhost:3021/login", 3500);
  await page.getByRole("button", { name: "ОК" }).click().catch(()=>{});
  await page.locator("input[name=email]").fill("+79210007788");
  await page.locator("input[name=password]").fill(PASS);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForTimeout(6000);
  await shot(page, "09-login-phone");
  console.log("A url", page.url());
  console.log("A text", (await page.evaluate(`document.body.innerText.slice(0,700)`)));

  // B) /mini/login
  const p2 = await ctx.newPage();
  await go(p2, "http://localhost:3021/mini/login", 6000);
  await shot(p2, "09-minilogin", true);
  console.log("B fields", JSON.stringify(await p2.evaluate(FIELDS), null, 1));
  console.log("B click", JSON.stringify((await p2.evaluate(CLICKABLES) as string[]).slice(0,15), null, 1));
  console.log("B text", (await p2.evaluate(`document.body.innerText.slice(0,900)`)));
  await browser.close();
  await db.$disconnect();
})();

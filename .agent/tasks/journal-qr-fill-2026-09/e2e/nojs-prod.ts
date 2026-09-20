import { chromium } from "playwright";
const URL = "https://wesetup.ru/journal-fill/cmtk2aeje000ao9tsesj20d9z/finished_product?token=journal%3Acmtk2aeje000ao9tsesj20d9z%3Afinished_product%3Acmtk2afai00vro9tsbmh48e9n.1789885358234.PEMirZ9txw8Bu1sOfMt2LCiM-HtCR-TuNveJJPHRNqg";
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "load", timeout: 120_000 });
  const links = page.locator('a[href*="employee="]');
  console.log("employee links:", await links.count());
  const name = (await links.first().innerText()).split("\n")[0];
  await links.first().click();
  await page.waitForLoadState("load");
  const body = (await page.evaluate(() => document.body.innerText.slice(0, 200))).replace(/\s+/g, " ");
  console.log("after tap (no JS):", body.includes(name) && body.includes("Сменить") ? "OK employee preselected" : "CHECK", "|", body.slice(0, 120));
  await browser.close();
})();

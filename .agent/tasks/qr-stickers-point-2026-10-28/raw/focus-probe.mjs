// После «‹ Назад»: пункт раздела, из которого вышли, — активный или только в фокусе? Локальная база.
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3026";
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(240000);
await page.goto(`${BASE}/login`, { waitUntil: "load" });
for (let i = 0; i < 6; i += 1) {
  await page.fill("#email", "dk-owner@test.local");
  await page.fill("#password", "Test-12345");
  if ((await page.inputValue("#email")) !== "dk-owner@test.local") continue;
  await page.click('button[type="submit"]');
  try { await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }); break; } catch { await page.waitForTimeout(1500); }
}
await page.goto(`${BASE}/settings/users`, { waitUntil: "load" });
await page.waitForSelector('[data-app-sidebar][data-sidebar-section="staff"]');
for (const how of ["mouse", "keyboard"]) {
  if (how === "keyboard") {
    await page.goto(`${BASE}/settings/users`, { waitUntil: "load" });
    await page.waitForSelector('[data-app-sidebar][data-sidebar-section="staff"]');
    await page.focus("[data-app-sidebar] [data-back-to-main]");
    await page.keyboard.press("Enter");
  } else {
    await page.click("[data-app-sidebar] [data-back-to-main]");
  }
  await page.waitForFunction(() => location.pathname === "/settings/buildings");
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const item = document.querySelector('[data-section-menu="points"] [data-menu-item="staff"]');
    return {
      ariaCurrent: item?.getAttribute("aria-current"),
      focused: document.activeElement === item,
      focusVisible: item?.matches(":focus-visible"),
      color: item ? getComputedStyle(item).color : null,
      bg: item ? getComputedStyle(item).backgroundColor : null,
      shadow: item ? getComputedStyle(item).boxShadow.slice(0, 60) : null,
    };
  });
  console.log(how, JSON.stringify(info));
}
await browser.close();

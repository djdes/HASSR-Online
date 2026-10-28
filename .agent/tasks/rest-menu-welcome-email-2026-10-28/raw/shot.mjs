// Скриншоты превью письма: 720 px и телефон 390 px.
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const dir = process.argv[2];
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
for (const [loc, w] of [["ru", 720], ["ru", 390], ["en", 720]]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  await p.goto(pathToFileURL(resolve(dir, `welcome-${loc}.html`)).href);
  await p.screenshot({ path: `${dir}/welcome-${loc}-${w}.png`, fullPage: true });
  console.log(loc, w, "scrollX", await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
}
await b.close();

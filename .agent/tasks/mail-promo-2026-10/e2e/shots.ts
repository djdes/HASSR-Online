// Снимки образцов писем: логотипы и таймер подменяются локальными файлами.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const ROOT = process.cwd();
const RAW = path.join(ROOT, ".agent/tasks/mail-promo-2026-10/raw");
const asset = (p: string) => "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "public", p)).toString("base64");
const gif = (theme: string) => "data:image/gif;base64," + fs.readFileSync(path.join(RAW, `countdown-${theme}.gif`)).toString("base64");
async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.E2E_CHROMIUM });
  const designs = (process.argv[2] ?? "aurora,coupon,countdown,compare,letter").split(",");
  const widths = (process.argv[3] ?? "680,390").split(",").map(Number);
  const scheme = (process.env.SCHEME ?? "light") as "light" | "dark";
  for (const d of designs) {
    let html = fs.readFileSync(path.join(RAW, `${d}.html`), "utf8");
    html = html.replace(/https:\/\/wesetup\.ru\/brand\/([a-z0-9-]+\.png)/g, (_, f) => asset(`brand/${f}`));
    html = html.replace(/https:\/\/wesetup\.ru\/api\/mailing\/countdown\.gif\?[^"']*theme=(dark|light)[^"']*/g, (_, t) => gif(t));
    for (const w of widths) {
      const page = await browser.newPage({ viewport: { width: w, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: "load" });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(RAW, `${d}-${w}-${scheme}.png`), fullPage: true });
      await page.close();
    }
  }
  await browser.close();
}
main();

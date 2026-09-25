// Сводные картинки «QR-страница | до | после» для AC1 (один PNG на тему).
// Запуск (после shots.ts before/after и qr-reference.ts):
//   npx tsx .agent/tasks/mini-qr-style-2026-09/e2e/compare.ts
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const EVIDENCE = path.join(HERE, "..", "evidence");
const CHROME = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");

function dataUrl(file: string): string {
  return `data:image/png;base64,${fs.readFileSync(path.join(EVIDENCE, file)).toString("base64")}`;
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1640, height: 900 }, deviceScaleFactor: 0.75 });
  for (const theme of ["light", "dark"]) {
    const cells = [
      ["QR-страница (эталон)", "qr-reference.png"],
      ["Сегодня — до", `before/${theme}-home-cook-today.png`],
      ["Сегодня — после", `after/${theme}-home-cook-today.png`],
      ["Заполнение — после", `after/${theme}-fill-claim.png`],
    ];
    const html = `<!doctype html><html><body style="margin:0;padding:16px;background:#e9ebf3;font:600 22px system-ui;display:flex;gap:16px">${cells
      .map(
        ([title, file]) =>
          `<figure style="margin:0"><figcaption style="margin:0 0 8px">${title}</figcaption><img src="${dataUrl(file)}" width="390" height="844" style="display:block;border-radius:12px;box-shadow:0 8px 24px -12px rgba(0,0,0,.35)"></figure>`
      )
      .join("")}</body></html>`;
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: path.join(EVIDENCE, `compare-${theme}.png`), fullPage: true });
    console.log("compare", theme);
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

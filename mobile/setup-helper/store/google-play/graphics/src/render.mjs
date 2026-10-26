// Рендер графики Google Play: node render.mjs <file.html> <out.png> <width> <height>
// Нужен Playwright (Chromium). На рабочем компьютере — лаунчер из презентации:
// D:/handoff/wesetup-2026-10-18/presentation/source/tools/browser.mjs.
import { launch } from "file:///D:/handoff/wesetup-2026-10-18/presentation/source/tools/browser.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [file, out, width, height] = process.argv.slice(2);
const browser = await launch({ args: ["--allow-file-access-from-files"] });
const page = await (await browser.newContext({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 })).newPage();
await page.goto(pathToFileURL(path.resolve(file)).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
await page.locator("#card").screenshot({ path: out, omitBackground: false });
console.log("ok", out);
await browser.close();

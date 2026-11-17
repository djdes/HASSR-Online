import { chromium } from "playwright";
const [html, out, width] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const p = await b.newPage({ viewport: { width: Number(width || 640), height: 900 }, deviceScaleFactor: 1 });
await p.goto("file://" + html); await p.waitForTimeout(500);
await p.screenshot({ path: out, fullPage: true });
await b.close();

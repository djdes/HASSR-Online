import { chromium } from "playwright";
const [html, out] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const p = await b.newPage({ viewport: { width: 560, height: 720 }, deviceScaleFactor: 1 });
await p.goto("file://" + html); await p.waitForTimeout(300);
await p.screenshot({ path: out, omitBackground: false });
await b.close();

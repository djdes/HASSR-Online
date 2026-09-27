// Контроль: те же жесты касанием на голом <input> (без приложения) — умеет ли эмуляция выделять.
// И проверка буфера headless shell (свой буфер в памяти, системный не трогает).
const path = require("node:path");
const { createRequire } = require("node:module");
const req = createRequire("C:/wt/jpage/package.json");
const { chromium } = req("playwright-core");
const SHELL = path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-win64/chrome-headless-shell.exe");
(async () => {
  const browser = await chromium.launch({ executablePath: SHELL, headless: true, args: ["--no-sandbox", "--use-gl=swiftshader"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div style="padding:24px"><input id="i" style="width:340px;height:48px;font-size:16px;padding:0 16px" value="Журнал контроля температурного режима"></div>');
  const cdp = await ctx.newCDPSession(page);
  const x = async (index) => page.evaluate((index) => { const i = document.getElementById("i"); i.setSelectionRange(0,0); i.scrollLeft = 0; const s = getComputedStyle(i); const c = document.createElement("canvas").getContext("2d"); c.font = `${s.fontSize} ${s.fontFamily}`; const b = i.getBoundingClientRect(); return { x: b.left + 16 + c.measureText(i.value.slice(0, index)).width, y: b.top + b.height / 2 }; }, index);
  const sel = () => page.evaluate(() => { const i = document.getElementById("i"); return [i.selectionStart, i.selectionEnd, document.activeElement === i]; });
  let p = await x(10);
  await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(300);
  console.log("tap", JSON.stringify(await sel()));
  p = await x(10);
  await cdp.send("Input.synthesizeTapGesture", { x: p.x, y: p.y, duration: 900, tapCount: 1, gestureSourceType: "touch" }); await page.waitForTimeout(600);
  console.log("longPress", JSON.stringify(await sel()));
  p = await x(10);
  await cdp.send("Input.synthesizeTapGesture", { x: p.x, y: p.y, tapCount: 2, gestureSourceType: "touch" }); await page.waitForTimeout(600);
  console.log("doubleTap", JSON.stringify(await sel()));
  // Буфер headless shell: копировать «Журнал» и вставить в конец.
  await page.evaluate(() => document.getElementById("i").setSelectionRange(0, 6));
  await page.keyboard.press("Control+C"); await page.keyboard.press("End"); await page.keyboard.press("Control+V");
  console.log("copyPaste", await page.evaluate(() => document.getElementById("i").value));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

// Скриншоты с подписями для карточки Play: чистый экран из StoreScreenshotsTest,
// сверху — короткая подпись на фирменном фоне, без рамки устройства.
// node captions.mjs <папка graphics> — пишет screenshots/phone-captioned/*.png.
import { launch } from "file:///D:/handoff/wesetup-2026-10-18/presentation/source/tools/browser.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2]);
const shots = [
  ["1-login.png", "Вход под учётной записью WeSetup вашего заведения"],
  ["2-main.png", "Принтер подключается за минуту, печать — без интернета"],
  ["3-print.png", "Шаблон, поля, предпросмотр — и этикетка готова"],
  ["4-history.png", "Вчерашнюю этикетку — повторить одним нажатием"],
];
const out = path.join(root, "screenshots", "phone-captioned");
fs.mkdirSync(out, { recursive: true });
const fonts = "file:///D:/handoff/wesetup-2026-10-18/presentation/source/node_modules/@fontsource";
const browser = await launch({ args: ["--allow-file-access-from-files"] });
const page = await (await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })).newPage();
for (const [file, caption] of shots) {
  const img = pathToFileURL(path.join(root, "screenshots", "phone", file)).href;
  const html = path.join(out, `.${file}.html`);
  fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${fonts}/unbounded/700.css"><link rel="stylesheet" href="${fonts}/onest/600.css">
<style>html,body{margin:0}#card{width:1080px;height:1920px;position:relative;overflow:hidden;
background:radial-gradient(70% 40% at 0% 0%,rgba(101,115,255,.8),transparent 70%),radial-gradient(60% 40% at 100% 30%,rgba(122,92,255,.55),transparent 70%),#1a2160}
h1{position:absolute;left:80px;right:80px;top:96px;margin:0;color:#fff;font-family:"Unbounded",sans-serif;font-weight:700;font-size:64px;line-height:1.12;letter-spacing:-.02em}
.shot{position:absolute;left:110px;top:430px;width:860px;border-radius:44px;overflow:hidden;box-shadow:0 50px 100px -40px rgba(0,0,0,.8),0 0 0 2px rgba(255,255,255,.15)}
.shot img{display:block;width:100%}</style></head>
<body><div id="card"><h1>${caption}</h1><div class="shot"><img src="${img}"></div></div></body></html>`);
  // Своим файлом, а не setContent: со страницы about:blank Chromium не грузит file:// картинки и шрифты.
  await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  fs.unlinkSync(html);
  await page.locator("#card").screenshot({ path: path.join(out, file) });
  console.log("ok", file);
}
await browser.close();

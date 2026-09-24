// Замер: кто занимает место внизу карточки #qr.
import { chromium } from "playwright-core";
import path from "node:path";

const exe = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--no-sandbox"] });
const width = Number(process.argv[2] || 1440);
const height = Number(process.argv[3] || 900);
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
await page.goto("http://localhost:3020/#qr", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector("[data-qr-player]", { timeout: 30000 });
await page.waitForTimeout(1500);
const data = await page.evaluate(() => {
  const round = (r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) });
  const section = document.querySelector("#qr");
  const card = section.querySelector(":scope > div");
  const player = document.querySelector("[data-qr-player]");
  const out = {
    section: round(section.getBoundingClientRect()),
    card: round(card.getBoundingClientRect()),
    player: round(player.getBoundingClientRect()),
    children: [...player.children].map((el) => ({
      tag: el.tagName,
      cls: (el.getAttribute("class") || "").slice(0, 60),
      display: getComputedStyle(el).display,
      rect: round(el.getBoundingClientRect()),
    })),
  };
  const inner = card.querySelector(":scope > div.relative");
  out.cardInner = inner ? round(inner.getBoundingClientRect()) : null;
  return out;
});
console.log(JSON.stringify(data, null, 2));
await browser.close();

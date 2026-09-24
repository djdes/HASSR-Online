// Телеметрия рассинхрона: data-frame vs реальное время, консоль-ошибки.
import { chromium } from "playwright-core";
import path from "node:path";

const exe = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) console.log("[console]", msg.type(), msg.text().slice(0, 200));
});
page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 300)));

await page.goto("http://localhost:3020/#qr", { waitUntil: "networkidle", timeout: 90000 });
await page.waitForSelector("[data-qr-player]");

const sample = async (label) => {
  const s = await page.evaluate(() => {
    const root = document.querySelector("[data-qr-player]");
    const players = document.querySelectorAll("[data-qr-stage] .__remotion-player, [data-qr-stage] [class*='remotion']").length;
    return {
      frame: root?.getAttribute("data-frame"),
      playing: root?.getAttribute("data-playing"),
      remotionNodes: players,
      underlay: Boolean(document.querySelector("[data-qr-stage] > div.\\@container")),
    };
  });
  console.log(label, JSON.stringify(s));
};

for (let i = 0; i < 5; i++) {
  await sample(`t+${i}s`);
  await page.waitForTimeout(1000);
}

// Пауза кнопкой (если играет), затем seek на 90 и три замера подряд.
await page.evaluate(() => document.querySelector('button[aria-label="Пауза"]')?.click());
await page.waitForTimeout(300);
await sample("after-pause");
await page.evaluate(() => {
  const input = document.querySelector("input.qrp-range:not(.qrp-range-try)");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, "90");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
for (let i = 0; i < 3; i++) {
  await page.waitForTimeout(800);
  await sample(`seek90+${i}`);
}
await browser.close();

// Эталон: HTML-страница заполнения по QR (тот же renderPage и QR_FILL_CSS,
// что отдаёт сервер), снятая на 390 px — рядом со снимками мини-приложения.
// Запуск: npx tsx .agent/tasks/mini-qr-style-2026-09/e2e/qr-reference.ts
import path from "node:path";
import { chromium } from "playwright-core";

import { renderHub, renderPage } from "@/lib/journal-fill-html";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CHROME = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");

async function main() {
  const body =
    `<div class="who"><div class="wl"><span class="k">Кто заполняет</span><span class="v">Иван Петров</span></div><a href="#">Сменить</a></div>` +
    renderHub([
      { code: "cold_equipment_control", name: "Холодильник №1 — утро", href: "#" },
      { code: "climate_control", name: "Климат склада", href: "#" },
      { code: "hygiene", name: "Гигиенический журнал", href: "#" },
    ]) +
    `<div class="card"><p class="label">Температура</p><div class="fl up"><input class="in" id="f-t" placeholder=" " value="4"><label for="f-t">Температура, °C</label></div><p class="muted">Норма +2…+6 °C</p></div>` +
    `<div class="sticky"><button class="btn" type="button">Записать</button></div>`;
  const html = renderPage({ orgName: "Кафе «Север»", title: "Журнал температуры", body, withJs: false });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: path.join(HERE, "..", "evidence", "qr-reference.png") });
  const hero = await page.evaluate(() => Math.round(document.querySelector(".hero")!.getBoundingClientRect().height));
  console.log("qr hero height", hero);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

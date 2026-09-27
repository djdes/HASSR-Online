// Снимки секции «Обязательные журналы»: телефон 390×844 (touch) и 1280×800, светлая и тёмная.
// Запуск: node e2e/shots.cjs <метка> [вариант a|b|c] [--top] [--full]
//   <метка>   — префикс файлов (before, variant-a, final …)
//   вариант   — временный переключатель строки ?rowv= (только на время подбора вариантов)
//   --top     — дополнительно снимок верха страницы (без прокрутки)
//   --full    — дополнительно вся секция целиком (телефон)
// Снимки — в E2E_OUT/shots (вне проекта), PNG с палитрой (≤ ~300 КБ).
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { WT, SHOTS, PHONE, DESKTOP, launch, readCreds, resetToday, themedContext, gotoSettled, loadAllThumbs } = require("./lib.cjs");

const sharp = createRequire(path.join(WT, "package.json"))("sharp");
const SECTION = 'details[data-storage-key="compliance-grid"]';

const args = process.argv.slice(2);
const label = args[0] || "shot";
const variant = args[1] && /^[abc]$/.test(args[1]) ? args[1] : null;
const withTop = args.includes("--top");
const withFull = args.includes("--full");

async function savePng(buffer, file) {
  const out = await sharp(buffer).png({ palette: true, quality: 92, effort: 8, compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(file, out);
  return Math.round(out.length / 1024);
}

async function dismissOverlays(page) {
  for (let i = 0; i < 3; i += 1) {
    const open = await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').count();
    if (!open) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
}

/** Прокрутка так, чтобы заголовок секции стоял сразу под липкой шапкой. */
async function scrollToSection(page) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const header = document.querySelector("header");
    const offset = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - offset - 12;
    window.scrollTo(0, Math.max(0, top));
  }, SECTION);
  await page.waitForTimeout(500);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const creds = readCreds();
  await resetToday(creds);
  const browser = await launch();
  const report = [];
  try {
    for (const [deviceName, device] of [
      ["phone", PHONE],
      ["desktop", DESKTOP],
    ]) {
      for (const theme of ["light", "dark"]) {
        const context = await themedContext(browser, device, theme, creds, {
          "wesetup.dashboard.section.compliance-grid": null,
        });
        const page = await context.newPage();
        const url = `/dashboard${variant ? `?rowv=${variant}` : ""}`;
        await gotoSettled(page, url, SECTION);
        await dismissOverlays(page);
        await loadAllThumbs(page);
        const base = `${label}-${deviceName}-${theme}`;
        if (withTop) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(300);
          report.push([`${base}-top.png`, await savePng(await page.screenshot(), path.join(SHOTS, `${base}-top.png`))]);
        }
        await scrollToSection(page);
        report.push([`${base}.png`, await savePng(await page.screenshot(), path.join(SHOTS, `${base}.png`))]);
        if (withFull && deviceName === "phone") {
          // Вся секция одним снимком: липкая шапка и плавающие кнопки на
          // время снимка спрятаны — иначе они ложатся поверх середины списка.
          await page.evaluate(() => {
            for (const img of document.querySelectorAll("details[data-storage-key] img")) img.loading = "eager";
            const style = document.createElement("style");
            style.id = "e2e-full-shot";
            style.textContent = "header,[class*='fixed']{visibility:hidden!important}";
            document.head.appendChild(style);
          });
          await page.waitForFunction(
            () => [...document.querySelectorAll("details[data-storage-key] img")].every((img) => img.complete),
            null,
            { timeout: 60000 },
          ).catch(() => {});
          const el = page.locator(SECTION);
          report.push([`${base}-full.png`, await savePng(await el.screenshot(), path.join(SHOTS, `${base}-full.png`))]);
          await page.evaluate(() => document.getElementById("e2e-full-shot")?.remove());
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  for (const [file, kb] of report) console.log(`${file}\t${kb} KB`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

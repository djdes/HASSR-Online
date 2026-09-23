// Статичный рендер галок (PIN верный + «Записано») на 390px: до/после правки.
// Запуск: npx tsx .agent/tasks/qr-quick-2026-09/e2e/check-static.ts <suffix> [reduced]
import path from "node:path";
import { chromium } from "playwright";
import * as ui from "../../../../src/lib/qr-pin-ui";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const suffix = process.argv[2] ?? "after";
const reduced = process.argv[3] === "reduced";
const OLD_SUCCESS = `<div style="margin:0 auto 16px;display:flex;width:80px;height:80px;border-radius:50%;background:#ecfdf5;color:#16a34a;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12.5 2.7 2.7L16.5 9.5"/></svg></div>`;
const anyUi = ui as Record<string, unknown>;
const success = typeof anyUi.QR_SUCCESS_CHECK_HTML === "string" ? (anyUi.QR_SUCCESS_CHECK_HTML as string) : OLD_SUCCESS;
const html = `<!doctype html><meta name=viewport content="width=device-width"><style>body{font-family:system-ui;background:#fafbff;margin:0;padding:16px}.card{background:#fff;border:1px solid #ececf4;border-radius:24px;padding:24px;text-align:center;margin-bottom:16px}${ui.QR_PIN_UI_CSS}</style>
<div class="card"><div style="font-weight:600;margin-bottom:8px">PIN верный</div>${ui.QR_PIN_OK_HTML.replace('class="qp-ok"', 'class="qp-ok" style="animation:none"')}<div style="color:#6f7282">поля формы ниже…</div></div>
<div class="card">${success}<h2 style="margin:0;font-size:22px">Записано</h2><p style="color:#6f7282">Температура 4°C сохранена в журнал.</p></div>`;

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  await page.setContent(html);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(HERE, "..", "shots", `check-static-${suffix}.png`), fullPage: true });
  const anim = await page.evaluate(() => {
    const el = document.querySelector(".qc");
    return el ? getComputedStyle(el).animationName : null;
  });
  console.log("animationName(.qc) =", anim);
  await browser.close();
})();

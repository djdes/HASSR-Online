// Печать на e2e-базе (порт 3020), не на проде: памятка «Сроки хранения» —
// один лист A4 со строкой про ярлык производителя; листы A5 и табличек —
// с пунктиром реза.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = ".agent/tasks/memo-storage-a5-cut-2026-10-29/raw";
mkdirSync(dir, { recursive: true });
const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
const base = "http://localhost:3020";
const out = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
};
const countPages = (buffer) => (buffer.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
const PX_PER_MM = 96 / 25.4;
const T = 420000;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(T);
  await page.goto(`${base}/login`, { timeout: T });
  await page.fill("#email", seed.manager);
  await page.fill("#password", "Verify-2026!");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: T });

  // ---- Памятка «Сроки хранения» --------------------------------------------
  await page.goto(`${base}/production-control/documents/posters/storage-times`, { timeout: T });
  await page.waitForSelector("[data-print-brand-frame]", { timeout: T });
  const text = await page.locator("[data-print-brand-frame]").first().innerText();
  check("памятка: строка «Или в соответствии с маркировочным ярлыком производителя.»", text.includes("Или в соответствии с маркировочным ярлыком производителя."));
  const memoPdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
  writeFileSync(`${dir}/storage-times.pdf`, memoPdf);
  check("памятка: ровно один лист A4", countPages(memoPdf) === 1, `листов: ${countPages(memoPdf)}`);
  await page.setViewportSize({ width: Math.round(190 * PX_PER_MM), height: 1000 });
  await page.emulateMedia({ media: "print" });
  const sizes = await page.evaluate((pxPerMm) => {
    const frame = document.querySelector("[data-print-brand-frame]");
    const content = frame?.querySelector("[data-poster-content]") ?? frame?.children[1];
    return {
      contentMm: content ? +(content.scrollHeight / pxPerMm).toFixed(1) : null,
      slotMm: content ? +(content.getBoundingClientRect().height / pxPerMm).toFixed(1) : null,
    };
  }, PX_PER_MM);
  check("памятка: содержимое помещается в лист", sizes.contentMm !== null && sizes.contentMm <= sizes.slotMm + 0.5, `${sizes.contentMm}/${sizes.slotMm} мм`);
  await page.locator("[data-print-brand-frame]").first().screenshot({ path: `${dir}/storage-times.png` });
  await page.emulateMedia({ media: null });
  await page.setViewportSize({ width: 1280, height: 1000 });

  // ---- Лист A5: два журнала в формате A5 --------------------------------------
  await page.goto(`${base}/settings/qr-posters`, { timeout: T });
  const a5 = page.getByRole("radio", { name: "A5", exact: true });
  await a5.first().waitFor({ timeout: T });
  await a5.nth(0).click();
  await a5.nth(1).click();
  await page.waitForTimeout(1500);
  await page.emulateMedia({ media: "print" });
  const a5Sheet = page.locator('[data-qr-sheet="a5"]').first();
  await a5Sheet.waitFor({ state: "attached", timeout: 60000 });
  const a5Borders = await page.locator(".qrp-a5").evaluateAll((els) => els.map((el) => {
    const s = getComputedStyle(el);
    return `${s.borderTopStyle}/${s.borderRightStyle}/${s.borderBottomStyle}/${s.borderLeftStyle}`;
  }));
  check("A5: первая половинка обведена пунктиром со всех сторон", a5Borders[0] === "dashed/dashed/dashed/dashed", a5Borders.join(" | "));
  check("A5: у второй сверху линии нет (общий край — одна линия)", a5Borders[1] === "none/dashed/dashed/dashed", a5Borders.join(" | "));
  await a5Sheet.screenshot({ path: `${dir}/a5-sheet.png` });
  await page.emulateMedia({ media: null });

  // ---- Таблички оборудования ---------------------------------------------------
  await page.goto(`${base}/settings/qr-posters?kind=equipment&layout=plate`, { timeout: T });
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  await page.emulateMedia({ media: "print" });
  const plateSheet = page.locator('[data-qr-sheet="plate"]').first();
  if (await plateSheet.count()) {
    const plateBorders = await page.locator(".qrp-plate").evaluateAll((els) => els.slice(0, 4).map((el) => {
      const s = getComputedStyle(el);
      return `${s.borderTopStyle}/${s.borderRightStyle}/${s.borderBottomStyle}/${s.borderLeftStyle}`;
    }));
    const expected = ["dashed/dashed/dashed/dashed", "dashed/dashed/dashed/none", "none/dashed/dashed/dashed", "none/dashed/dashed/none"];
    check("таблички: пунктир по краям, общие края — одной линией", plateBorders.every((value, index) => value === expected[index]), plateBorders.join(" | "));
    await plateSheet.screenshot({ path: `${dir}/plate-sheet.png` });
  } else {
    check("таблички: на e2e-базе нет оборудования с табличкой — лист не построен", false, "нет [data-qr-sheet=plate]");
  }
} catch (error) {
  out.push(`ОШИБКА: ${String(error.message).split("\n")[0]}`);
  console.log(out[out.length - 1]);
} finally {
  await browser.close();
  writeFileSync(`${dir}/print-check.txt`, out.join("\n") + "\n");
}

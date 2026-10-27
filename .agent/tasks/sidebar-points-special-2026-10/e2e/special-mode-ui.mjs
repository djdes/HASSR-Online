// Спецрежим в браузере (e2e-база): по умолчанию выключен, включение — окно с
// галочками, выбор сохраняется, выключение — подтверждение.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const dir = ".agent/tasks/sidebar-points-special-2026-10/e2e";
const seed = JSON.parse(readFileSync(".agent/tasks/qr-point-roster-uv-2026-10/raw/seed.json", "utf8"));
const base = "http://localhost:3020";
const out = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const controls = async () => (await (await page.request.get(`${base}/api/settings/journal-controls`)).json());
try {
  await page.goto(`${base}/login`);
  await page.fill("#email", `manager-${seed.orgId}@verify.local`);
  await page.fill("#password", "Verify-2026!");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180000 });

  await page.goto(`${base}/inspection/special-mode`, { timeout: 180000 });
  const terms = page.getByRole("button", { name: "Принять и продолжить" });
  if (await terms.isVisible({ timeout: 8000 }).catch(() => false)) {
    await page.locator('input[type="checkbox"]').first().check();
    await terms.click();
  }
  await page.keyboard.press("Escape");
  const before = await controls();
  out.push(`по умолчанию: ${JSON.stringify(before.controls?.automation ?? before.automation ?? before)}`);

  const autoBefore = await page.request.get(`${base}/settings/auto-journals`, { maxRedirects: 0 });
  out.push(`/settings/auto-journals при выключенном: HTTP ${autoBefore.status()} → ${autoBefore.headers()["location"] ?? "-"}`);

  const toggle = page.getByRole("switch").first();
  out.push(`переключатель включён: ${await toggle.getAttribute("aria-checked")}`);
  await toggle.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 15000 });
  const boxes = dialog.getByRole("checkbox");
  out.push(`окно: «${(await dialog.getByRole("heading").first().innerText()).trim()}», галочек ${await boxes.count()}`);
  await page.screenshot({ path: `${dir}/special-01-dialog.png` });
  // Снимаем «Скопировать вчерашнее».
  await dialog.getByText("Скопировать вчерашнее", { exact: false }).first().click();
  await dialog.getByRole("button", { name: /Включить/ }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
  await page.waitForTimeout(1500);
  const after = await controls();
  out.push(`после «Включить»: ${JSON.stringify(after.controls?.automation ?? after.automation ?? after)}`);
  await page.screenshot({ path: `${dir}/special-02-on.png` });

  const autoAfter = await page.request.get(`${base}/settings/auto-journals`, { maxRedirects: 0 });
  out.push(`/settings/auto-journals при включённом автосоздании: HTTP ${autoAfter.status()}`);

  await page.getByRole("switch").first().click();
  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await confirm.first().waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${dir}/special-03-off-confirm.png` });
  out.push(`подтверждение выключения: «${(await confirm.first().innerText()).replace(/\s+/g, " ").slice(0, 220)}»`);
  await confirm.first().getByRole("button", { name: /Выключить/ }).click();
  await page.waitForTimeout(1500);
  const off = await controls();
  out.push(`после выключения: ${JSON.stringify(off.controls?.automation ?? off.automation ?? off)}`);
} catch (error) {
  out.push(`ОШИБКА: ${error.message.split("\n")[0]}`);
  await page.screenshot({ path: `${dir}/special-error.png` }).catch(() => {});
} finally {
  await browser.close();
  writeFileSync(`${dir}/special-mode-ui.txt`, out.join("\n") + "\n");
  console.log(out.join("\n"));
}

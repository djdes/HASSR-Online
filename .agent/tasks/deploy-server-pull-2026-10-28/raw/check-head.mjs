// Заведующая точки А на сайте (e2e-база, порт 3020): меню журналов,
// точка в шапке, «Вся организация» закрыта. Повтор шага reverify.mjs,
// который упал на переходе страницы во время чтения меню.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const dir = ".agent/tasks/deploy-server-pull-2026-10-28/raw/reverify";
const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
const base = "http://localhost:3020";
const out = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
try {
  const head = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await head.goto(`${base}/login`, { timeout: 420000 });
  await head.fill("#email", seed.head);
  await head.fill("#password", "Verify-2026!");
  await head.keyboard.press("Enter");
  await head.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 420000 });
  await head.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  console.log("после входа:", head.url());

  await head.goto(`${base}/journals/points`, { timeout: 420000 });
  await head.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  console.log("журналы точек:", head.url());
  const terms = head.getByRole("button", { name: "Принять и продолжить" });
  if (await terms.isVisible({ timeout: 6000 }).catch(() => false)) {
    await head.locator('input[type="checkbox"]').first().check();
    await terms.click();
    await head.waitForTimeout(1000);
  }
  await head.keyboard.press("Escape");
  const labels = await head.locator("aside nav a, aside a[href]").evaluateAll((links) => links.map((a) => a.textContent.trim()).filter(Boolean));
  check("заведующая: в меню нет «Журналов точек» и «Всех журналов», есть «Сегодня»", !labels.includes("Журналы точек") && !labels.includes("Все журналы") && labels.includes("Сегодня"), labels.join(" | "));
  check("заведующая: «Журналы точек» — экран «недоступно»", (await head.locator("[data-point-mode-unavailable]").count()) === 1);
  const caption = (await head.locator("[data-current-point]").first().innerText().catch(() => "")).replace(/\s+/g, " ");
  check("заведующая: в шапке её точка, «Вся организация» нет", caption.includes("Точка А") && !caption.includes("Вся организация"), caption);
  check("заведующая: на экране нет кнопки «Выбрать всю организацию»", (await head.locator("[data-point-mode-organization]").count()) === 0);
  const status = await head.request.post(`${base}/api/me/active-building`, { data: { buildingId: "organization" } });
  check("заведующей «Вся организация» недоступна в API", status.status() === 403 || status.status() === 400, String(status.status()));
  await head.screenshot({ path: `${dir}/8-head-chef.png` });
} catch (error) {
  out.push(`ОШИБКА: ${String(error.message).split("\n")[0]}`);
} finally {
  await browser.close();
  writeFileSync(`${dir}/check-head.txt`, out.join("\n") + "\n");
}

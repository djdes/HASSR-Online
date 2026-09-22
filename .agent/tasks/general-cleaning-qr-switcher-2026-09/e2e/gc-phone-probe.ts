// Проба листа года/месяца на телефоне после окончания анимаций: видны ли
// заголовок листа и «Все месяцы», не остаётся ли прокрутка от списка месяцев.
// Запуск: BASE=http://localhost:3031 npx tsx .agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/gc-phone-probe.ts
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3031";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
const state = JSON.parse(fs.readFileSync(path.join(HERE, "gc-state.json"), "utf8"));

async function main() {
  const doc = await db.journalDocument.findFirstOrThrow({
    where: { organizationId: state.orgId, template: { code: "general_cleaning" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ru-RU",
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 600_000 });
  await page.fill("#email", state.managerEmail);
  await page.fill("#password", state.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 600_000 });
  await page.goto(`${BASE}/journals/general_cleaning/documents/${doc.id}`, { waitUntil: "load", timeout: 600_000 });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "изменить" }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, "gc-a9-year-sheet.png") });
  const title = page.locator("[data-vaul-drawer] h2, [role=dialog] h2").first();
  const yearTitleBox = await title.boundingBox().catch(() => null);
  await page.getByRole("button", { name: /^Сентябрь/ }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, "gc-a9-month-in-sheet.png") });
  const back = page.getByRole("button", { name: "Все месяцы" });
  const backBox = await back.boundingBox().catch(() => null);
  const monthTitleBox = await title.boundingBox().catch(() => null);
  console.log(JSON.stringify({ yearTitleBox, monthTitleBox, backBox }));
  await browser.close();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

// Все сообщения консоли (error/warning) на странице документа генуборок —
// без фильтров, на компьютере и на телефоне, плюс открытие редактора месяца.
// Запуск: BASE=http://localhost:3031 npx tsx .agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/gc-console-probe.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3031";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const state = JSON.parse(fs.readFileSync(path.join(HERE, "gc-state.json"), "utf8"));

async function probe(context: BrowserContext, docId: string, label: string) {
  const messages: string[] = [];
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") messages.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => messages.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 600_000 });
  await page.fill("#email", state.managerEmail);
  await page.fill("#password", state.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 600_000 });
  messages.length = 0;
  await page.goto(`${BASE}/journals/general_cleaning/documents/${docId}`, { waitUntil: "load", timeout: 600_000 });
  await page.waitForTimeout(2500);
  const cell = page.getByRole("button", { name: /^Сентябрь, Кухня \(e2e\): план/ }).first();
  if (await cell.isVisible().catch(() => false)) {
    await cell.click();
    await page.waitForTimeout(1200);
  }
  fs.writeFileSync(path.join(HERE, `gc-console-${label}.json`), JSON.stringify(messages, null, 1));
  console.log(label, messages.length);
  await page.close();
}

async function main() {
  const doc = await db.journalDocument.findFirstOrThrow({
    where: { organizationId: state.orgId, template: { code: "general_cleaning" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const browser = await chromium.launch({ channel: "chrome" });
  await probe(await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" }), doc.id, "desktop");
  await probe(
    await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU", isMobile: true, hasTouch: true }),
    doc.id,
    "phone",
  );
  await browser.close();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

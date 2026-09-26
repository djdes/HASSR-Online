/**
 * Откуда предупреждение гидратации на телефоне (390, touch): полный текст
 * с деревом компонентов. Запуск: npx tsx .agent/tasks/journal-title-rename-2026-09/e2e/hydration-probe.ts
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE ?? "http://localhost:3047";
const TASK_DIR = path.resolve(".agent/tasks/journal-title-rename-2026-09");
const setup = JSON.parse(readFileSync(path.join(TASK_DIR, "e2e/setup-output.json"), "utf8"));
const CHROME = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright/chromium-1232/chrome-win64/chrome.exe");
const url = process.env.PROBE_URL ?? `/journals/${setup.journal}`;

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=swiftshader", "--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ru-RU" });
  const res = await context.request.post(`${BASE}/api/auth/login`, { data: { email: setup.cookEmail, password: setup.password }, timeout: 240_000 });
  if (!res.ok()) throw new Error(`login ${res.status()}`);
  const page = await context.newPage();
  const messages: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") messages.push(m.text()); });
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.locator("h1").first().waitFor({ timeout: 240_000 });
  await page.waitForTimeout(4000);
  await browser.close();
  const hydration = messages.filter((m) => m.includes("hydrated"));
  writeFileSync(path.join(TASK_DIR, "evidence", "hydration-390.txt"), hydration.join("\n\n-----\n\n"));
  console.log(hydration.map((m) => m.split("\n").filter((l) => /^\s*[-+<]/.test(l)).slice(-40).join("\n")).join("\n=====\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });

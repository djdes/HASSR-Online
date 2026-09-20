// Третье оборудование: в полосе должен быть виден снятый «Морозильник» с показанием.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "seed-objects.json"), "utf8")) as { equipment: Array<{ href: string }> };
(async () => {
  const b = await chromium.launch({ channel: "chrome" });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 })).newPage();
  await p.goto(`http://localhost:3020${seed.equipment[2].href}`, { waitUntil: "load", timeout: 240_000 });
  await p.waitForSelector("input[inputmode=decimal]", { timeout: 120_000 });
  console.log("strip:", (await p.locator("[aria-current=true]").first().locator("xpath=..").innerText()).replace(/\s+/g, " "));
  console.log("trigger:", (await p.locator("button[role=combobox]").first().innerText()).replace(/\s+/g, " | "));
  await p.screenshot({ path: path.join(ROOT, "shots", "equipment-next.png"), fullPage: true });
  await b.close();
})();

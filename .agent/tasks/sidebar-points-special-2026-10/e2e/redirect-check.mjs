import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const seed = JSON.parse(readFileSync("D:/wt/qr-point-uv/.agent/tasks/qr-point-roster-uv-2026-10/raw/seed.json", "utf8"));
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH }); const p = await b.newPage();
await p.goto("http://localhost:3020/login"); await p.fill("#email", `manager-${seed.orgId}@verify.local`); await p.fill("#password", "Verify-2026!"); await p.keyboard.press("Enter");
await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180000 });
await p.goto("http://localhost:3020/settings/auto-journals", { timeout: 180000 }); await p.waitForTimeout(3000);
console.log("off -> final URL:", new URL(p.url()).pathname);
await b.close();

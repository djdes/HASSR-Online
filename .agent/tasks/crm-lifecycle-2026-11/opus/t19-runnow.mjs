import { login, close, BASE, OUT, errors } from "./lib.mjs";
const alexey = await login("alexey");
const p = alexey.page;
const r = await p.goto(`${BASE}/root/crm/automation`, { waitUntil: "networkidle" });
console.log("alexey automation page:", r.status());
// UI validation: bad stage text
await p.fill("[data-automation-trial]", "4, 2, 0, 120, abc");
await p.click("[data-automation-save]");
await p.waitForTimeout(1500);
console.log("toast after weird stages:", (await p.locator("[data-sonner-toast]").last().innerText().catch(() => "-")).replace(/\s+/g, " "));
await p.reload({ waitUntil: "networkidle" });
console.log("trial stages after save:", await p.inputValue("[data-automation-trial]"));
// holidays bad
const hol = p.locator("textarea").last();
await hol.fill("2026-12-31, 2027-01-01");
await p.click("[data-automation-save]");
await p.waitForTimeout(1500);
console.log("toast after bad holidays:", (await p.locator("[data-sonner-toast]").last().innerText().catch(() => "-")).replace(/\s+/g, " "));
await hol.fill("");
await p.fill("[data-automation-trial]", "4, 2");
await p.click("[data-automation-save]");
await p.waitForTimeout(1500);
await p.locator("button", { hasText: "Прогнать сейчас" }).click();
await p.waitForTimeout(15000);
console.log("run toast:", (await p.locator("[data-sonner-toast]").allInnerTexts()).map((s) => s.replace(/\s+/g, " ")).join(" || "));
await p.screenshot({ path: `${OUT}/ui-08-automation-run.png`, fullPage: false });
console.log("errors", errors.length, errors.join(" | "));
await close();

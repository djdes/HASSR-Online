// Сводка прогонов Playwright → raw/playwright-summary.json (для evidence).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAW = path.join(path.dirname(fileURLToPath(import.meta.url)), "raw");
const parts = ["owner", "owner-tail", "phone", "mini", "headchef", "headchef-mini", "cook"];
const summary = {};
for (const part of parts) {
  const file = path.join(RAW, `results-${part}.json`);
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  summary[part] = {
    finishedAt: data.finishedAt,
    pass: data.checks.filter((c) => c.ok).length,
    fail: data.checks.filter((c) => !c.ok).map((c) => `${c.name} — ${JSON.stringify(c.detail)}`),
    menuRetries: data.menuRetries ?? [],
  };
}
fs.writeFileSync(path.join(RAW, "playwright-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

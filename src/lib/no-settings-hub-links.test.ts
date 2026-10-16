import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Хаб /settings — только редирект: ссылаться на него нельзя,
// ссылки должны вести в конкретный раздел или страницу настроек.
const SRC = path.resolve(process.cwd(), "src");
const HUB_PAGE = path.join("src", "app", "(dashboard)", "settings", "page.tsx");
const FORBIDDEN = [
  /href="\/settings"/,
  /href:\s*"\/settings"/,
  /href=\{\s*"\/settings"\s*\}/,
  /<Link href="\/settings">/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test("в коде нет ссылок на хаб /settings", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(process.cwd(), file);
    if (rel === HUB_PAGE) continue;
    const text = readFileSync(file, "utf8");
    if (FORBIDDEN.some((re) => re.test(text))) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

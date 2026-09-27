// Новые предупреждения ESLint от правки: текущий файл против версии из HEAD (lintText с тем же путём).
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const require = createRequire("C:/wt/jpage/package.json");
const { ESLint } = require("eslint");
process.chdir("C:/wt/jpage");
const files = execSync("git diff --name-only -- src", { encoding: "utf8" }).trim().split("\n").filter(Boolean);
files.push("src/components/journals/journal-page-polish.test.ts");
const eslint = new ESLint({ cwd: "C:/wt/jpage" });
const key = (m) => `${m.ruleId}: ${m.message.split("\n")[0]}`;
let added = 0;
for (const f of files) {
  const [now] = await eslint.lintText(readFileSync(f, "utf8"), { filePath: f });
  let baseText = null;
  try { baseText = execSync(`git show HEAD:"${f}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch {}
  const base = baseText ? (await eslint.lintText(baseText, { filePath: f }))[0] : { messages: [] };
  const counts = new Map();
  for (const m of base.messages) counts.set(key(m), (counts.get(key(m)) || 0) + 1);
  for (const m of now.messages) {
    const k = key(m);
    if (counts.get(k)) counts.set(k, counts.get(k) - 1);
    else { added += 1; console.log(`NEW ${f}:${m.line} ${k}`); }
  }
}
console.log(`new messages: ${added}`);

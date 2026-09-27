// Самописные вкладки «Активные / Закрытые» → <JournalTabs>. Печатает, что заменено в каждом файле.
const fs = require("node:fs");
const path = require("node:path");
const DIR = "C:/wt/jpage/src/components/journals";
const files = fs.readdirSync(DIR).filter((f) => f.endsWith("-documents-client.tsx"));
const report = [];
for (const file of files) {
  const full = path.join(DIR, file);
  let src = fs.readFileSync(full, "utf8");
  if (!/after:bg-\[#5566f6\]/.test(src) || /<JournalTabs\b/.test(src)) continue;
  const lines = src.split("\n");
  const activeIdx = lines.findIndex((l) => /(^|>)\s*Активные\s*(<|$)/.test(l) || /Активные<\/Link>/.test(l));
  if (activeIdx < 0) { report.push(`${file}: NO ACTIVE LABEL`); continue; }
  // Контейнер вкладок: ближайший <div ...border-b...> выше.
  let start = -1;
  for (let i = activeIdx; i >= 0 && i > activeIdx - 20; i -= 1) {
    if (/<div className="[^"]*border-b[^"]*">/.test(lines[i])) { start = i; break; }
  }
  if (start < 0) { report.push(`${file}: NO CONTAINER`); continue; }
  // Парный </div>.
  let depth = 0, end = -1;
  for (let i = start; i < lines.length; i += 1) {
    depth += (lines[i].match(/<div\b/g) || []).length;
    depth -= (lines[i].match(/<\/div>/g) || []).length;
    if (depth === 0) { end = i; break; }
  }
  const block = lines.slice(start, end + 1).join("\n");
  if (!/Закрытые/.test(block)) { report.push(`${file}: BLOCK WITHOUT Закрытые`); continue; }
  const href = /href=\{`\/journals\/\$\{([^}]+)\}`\}/.exec(block);
  const active = /([A-Za-z.]*activeTab) === "active"/.exec(block);
  if (!href || !active) { report.push(`${file}: CANNOT PARSE href/activeTab`); continue; }
  // Комментарий про вкладки прямо над блоком — тоже уходит.
  let from = start;
  if (/^\s*\{\/\*.*(Tabs|Вкладки)/.test(lines[start - 1] || "")) {
    let j = start - 1;
    while (j > 0 && !/\{\/\*/.test(lines[j])) j -= 1;
    from = j;
  }
  const indent = /^(\s*)/.exec(lines[start])[1];
  const replacement = `${indent}<JournalTabs activeTab={${active[1]}} templateCode={${href[1]}} />`;
  lines.splice(from, end - from + 1, replacement);
  src = lines.join("\n");
  // Импорт JournalTabs.
  const importRe = /import \{([^}]*)\} from "@\/components\/journals\/document-list-ui";/;
  const m = importRe.exec(src);
  if (m) {
    const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    if (!names.includes("JournalTabs")) names.push("JournalTabs");
    const multiline = m[1].includes("\n");
    const joined = multiline ? `\n  ${names.join(",\n  ")},\n` : ` ${names.join(", ")} `;
    src = src.replace(importRe, `import {${joined}} from "@/components/journals/document-list-ui";`);
  } else {
    // После последнего import-а из @/components/journals/.
    const all = [...src.matchAll(/^import [^;]+;\s*$/gm)];
    const last = all[all.length - 1];
    const at = last.index + last[0].length;
    src = src.slice(0, at) + `\nimport { JournalTabs } from "@/components/journals/document-list-ui";` + src.slice(at);
  }
  // Больше не нужные токены вкладок.
  for (const token of ["JOURNAL_TAB_RAIL_CLASS", "JOURNAL_TAB_VIEWPORT_CLASS"]) {
    const uses = (src.match(new RegExp(`\b${token}\b`, "g")) || []).length;
    if (uses === 1) src = src.replace(new RegExp(`\n\s*${token},`), "");
  }
  const linkUses = (src.match(/<Link\b/g) || []).length;
  fs.writeFileSync(full, src);
  report.push(`${file}: lines ${from + 1}-${end + 1} → JournalTabs activeTab={${active[1]}} templateCode={${href[1]}}; <Link> left: ${linkUses}`);
}
console.log(report.join("\n"));

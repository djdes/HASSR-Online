import fs from "node:fs";
const rows = JSON.parse(fs.readFileSync("D:/www/Wesetup.ru/.agent/tasks/mini-sweep-2026-09/explore-mgmt/parity-result.json", "utf8"));
const by: Record<string, any> = {};
for (const r of rows) by[`${r.tag}|${r.route}`] = r;
const roles = [...new Set(rows.map((r: any) => r.tag.split(":")[1]))];
const routes = [...new Set(rows.map((r: any) => r.route))];
for (const role of roles) {
  const out: string[] = [];
  for (const rt of routes) {
    const a = by[`shell:${role}|${rt}`], b = by[`site:${role}|${rt}`];
    if (!a || !b) continue;
    const norm = (x: any) => (x.final || "").split("?")[0];
    if (norm(a) !== norm(b) || a.verdict !== b.verdict) {
      out.push(`| ${rt} | ${norm(a)} (${a.verdict}) | ${norm(b)} (${b.verdict}) |`);
    }
  }
  console.log(`\n## ${role} — расхождений ${out.length}`);
  console.log(out.join("\n"));
}

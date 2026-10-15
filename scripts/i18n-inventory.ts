import ts from "typescript";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ACTIVE_JOURNAL_CATALOG } from "../src/lib/journal-catalog";

// Candidates require review: a source scan cannot distinguish customer seed
// data, machine values and product copy, nor prove that a screen is translated.
const out = ".agent/tasks/english-version-1375e736/raw/full-localization";
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`;
    if (file === "public/uploads") return [];
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const files = ["src", "prisma", "public"].flatMap(walk).filter((file) =>
  /\.(tsx?|jsx?)$/.test(file) && !/\.(test|spec)\./.test(file) && !file.endsWith(".d.ts") && !file.includes("/generated/"),
);
const journalNames = new Map<string, string>(ACTIVE_JOURNAL_CATALOG.map(({ code, name }) => [code, name]));
const activeCodes = new Set<string>(journalNames.keys());
const candidates: { file: string; line: number; kind: string; text: string }[] = [];
for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true,
    file.endsWith("tsx") ? ts.ScriptKind.TSX : file.endsWith("jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TS);
  function visit(node: ts.Node) {
    if (file === "prisma/seed.ts" && ts.isVariableDeclaration(node) && node.name.getText(source) === "journalTemplates" && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      for (const template of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(template)) continue;
        const values = new Map(template.properties.flatMap((property) =>
          ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer)
            ? [[property.name.getText(source), property.initializer.text] as const] : []));
        const code = values.get("code"), name = values.get("name");
        if (code && name && !journalNames.has(code)) journalNames.set(code, name);
      }
    }
    const literal = ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    if (literal) {
      const text = node.text.trim();
      const uiAttribute = ts.isJsxAttribute(node.parent) && /^(title|placeholder|alt|aria-label|label)$/.test(node.parent.name.getText(source));
      if (text && (/[А-Яа-яЁё]/.test(text) || ((ts.isJsxText(node) || uiAttribute) && /[a-zA-Z]/.test(text)))) {
        candidates.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind: ts.SyntaxKind[node.kind], text });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const byFile = new Map<string, number>();
for (const item of candidates) byFile.set(item.file, (byFile.get(item.file) ?? 0) + 1);
const report = {
  generatedAt: new Date().toISOString(),
  status: "INCOMPLETE",
  scope: "Source inventory only; database content and rendered states require separate review.",
  sourceFiles: files.length,
  candidateCount: candidates.length,
  filesWithCandidates: byFile.size,
  routes: files.filter((file) => /\/page\.tsx?$/.test(file)).map((file) => ({ file, status: "PENDING", locales: ["ru", "en", "uz"] })),
  journals: [...journalNames].map(([code, name]) => ({ code, name, active: activeCodes.has(code), status: "PENDING", locales: ["ru", "en", "uz"] })),
  candidateFiles: [...byFile].map(([file, count]) => ({ file, count })).sort((a, b) => b.count - a.count),
  databaseContent: "PENDING: templates, historical journals, articles, notifications and organization customizations",
  candidates,
};
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "inventory.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ files: files.length, candidates: candidates.length, affectedFiles: byFile.size, routes: report.routes.length, journals: report.journals.length }));

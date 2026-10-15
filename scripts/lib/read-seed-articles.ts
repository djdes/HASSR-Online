import ts from "typescript";
import { readFile } from "node:fs/promises";
import type { ArticleSource } from "../../src/lib/article-localization";

// Evaluate literal syntax only. Never import/execute a seed that writes to a database.
function literal(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(item => literal(item));
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(property => {
    if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) throw new Error("Unsupported article property");
    return [property.name.text, literal(property.initializer)];
  }));
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Date"
    && node.arguments?.length === 1 && ts.isStringLiteral(node.arguments[0])) return node.arguments[0].text;
  throw new Error(`Unsupported article expression: ${ts.SyntaxKind[node.kind]}`);
}

export async function readSeedArticles(filename = "prisma/seed-articles.ts"): Promise<Array<ArticleSource & { slug: string }>> {
  const source = ts.createSourceFile(filename, await readFile(filename, "utf8"), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === "ARTICLES" && declaration.initializer) {
        return literal(declaration.initializer) as Array<ArticleSource & { slug: string }>;
      }
    }
  }
  throw new Error("Article source array not found");
}

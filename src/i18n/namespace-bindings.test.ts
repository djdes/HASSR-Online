import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { loadMessages } from "./messages";
import { flattenMessages } from "./catalog-validation";

function namespacesInSource(source: string, filename: string): string[] {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const imports = new Set<string>();
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) ||
        !["next-intl", "next-intl/server", "use-intl/core"].includes(node.moduleSpecifier.text)) continue;
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      if (["useTranslations", "getTranslations", "createTranslator"].includes((binding.propertyName ?? binding.name).text)) imports.add(binding.name.text);
    }
  }
  const namespaces: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && imports.has(node.expression.text)) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) namespaces.push(argument.text);
      else if (argument && ts.isObjectLiteralExpression(argument)) {
        for (const property of argument.properties) {
          if (ts.isPropertyAssignment(property) && property.name.getText(ast) === "namespace" && ts.isStringLiteralLike(property.initializer)) namespaces.push(property.initializer.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return namespaces;
}

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.tsx?$/.test(path) && !/\.(?:test|d)\.ts$/.test(path) ? [path] : [];
  });
}

test("literal next-intl namespaces in current production sources exist in the canonical catalog", async () => {
  const messages = await loadMessages("ru");
  const missing: string[] = [];
  let checked = 0;
  for (const file of files("src")) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("next-intl") && !source.includes("use-intl/core")) continue;
    for (const namespace of namespacesInSource(source, file)) {
      let value: unknown = messages;
      for (const part of namespace.split(".")) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
      if (!value || typeof value !== "object") missing.push(`${file}: ${namespace}`);
      checked++;
    }
  }
  assert.ok(checked > 100, "must inspect the actual migrated application");
  assert.deepEqual(missing, [], "invalid production translator bindings");
});

test("namespace scanner follows imports and ignores comments and unrelated functions", () => {
  assert.deepEqual(namespacesInSource(`
    import {useTranslations as translate} from 'next-intl';
    import {getTranslations} from 'next-intl/server';
    import {createTranslator} from 'use-intl/core';
    // translate('not-a-call');
    translate('staffManagement.dialogs.api');
    getTranslations({locale: 'en', namespace: 'journalControls.guide'});
    createTranslator({locale: 'uz', messages: {}, namespace: 'journalApi'});
    useTranslations('not-imported');
  `, "example.ts"), ["staffManagement.dialogs.api", "journalControls.guide", "journalApi"]);
});

test("catalog keys cannot hide dotted literal IDs that next-intl treats as nested paths", () => {
  assert.throws(() => flattenMessages({ cards: { "settings.onboarding": { title: "Start" } } }), /Invalid message key segment/);
  assert.deepEqual(flattenMessages({ cards: { settings_onboarding: { title: "Start" } } }), { "cards.settings_onboarding.title": "Start" });
});

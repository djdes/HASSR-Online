import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIVE_JOURNAL_CATALOG } from "../lib/journal-catalog";
import { REGISTER_JOURNALS } from "../lib/register-journals";
import { loadMessages } from "./messages";
import { journalTitle, presentJournalField } from "./journal-presentation";
import { readFileSync } from "node:fs";
import ts from "typescript";

test("all 45 catalog journals have names in all three languages", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const journal of ACTIVE_JOURNAL_CATALOG) {
      assert.ok(messages.journals.names[journal.code]);
      const title = journalTitle(locale, messages.journals.names, journal.code, journal.name);
      if (locale !== "ru") assert.doesNotMatch(title, /[А-Яа-яЁё]/);
      assert.equal(journalTitle(locale, messages.journals.names, journal.code, journal.name, "Наш журнал"), "Наш журнал");
    }
    assert.equal(journalTitle(locale, messages.journals.names, "custom", "Наш шаблон"), "Наш шаблон");
  }
});

test("localized answers retain their legacy values, original labels and validation metadata", () => {
  const field = Object.freeze({ key: "grade", label: "Оценка", required: true, options: [{ value: "Хорошо", label: "Хорошо" }], showIf: { field: "result", equals: "Годен" } });
  const result = presentJournalField(field, { label: "Quality", options: { "Хорошо": "Good" } });
  assert.equal(result.label, "Оценка");
  assert.equal(result.displayLabel, "Quality");
  assert.equal(result.displayOptions?.[0].label, "Good");
  assert.equal(result.displayOptions?.[0].value, "Хорошо");
  assert.deepEqual(result.options, field.options);
  assert.equal(result.showIf, field.showIf);
  assert.equal(presentJournalField(field, { label: "Quality" }, "Оценка повара").displayLabel, "Оценка повара");
  assert.equal(presentJournalField(field, undefined).displayOptions?.[0].label, "Хорошо");
});

test("field catalogs match seeded keys and option values, preserving the original Russian labels", async () => {
  const source = ts.createSourceFile("seed.ts", readFileSync("prisma/seed.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const seeded = new Map<string, Map<string, string[]>>();
  const labels = new Map<string, string>();
  const property = (node: ts.ObjectLiteralExpression, key: string) => {
    const item = node.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText(source) === key);
    return item && ts.isPropertyAssignment(item) ? item.initializer : undefined;
  };
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "journalTemplates" && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      for (const template of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(template)) continue;
        const code = property(template, "code"), fields = property(template, "fields");
        if (!code || !ts.isStringLiteralLike(code) || !fields || !ts.isArrayLiteralExpression(fields)) continue;
        const keys = new Map<string, string[]>();
        for (const field of fields.elements) {
          if (!ts.isObjectLiteralExpression(field)) continue;
          const key = property(field, "key"), options = property(field, "options"), label = property(field, "label");
          if (!key || !ts.isStringLiteralLike(key)) continue;
          if (label && ts.isStringLiteralLike(label)) labels.set(`${code.text}.${key.text}`, label.text);
          keys.set(key.text, options && ts.isArrayLiteralExpression(options) ? options.elements.flatMap((option) => {
            const value = ts.isObjectLiteralExpression(option) ? property(option, "value") : undefined;
            const optionLabel = ts.isObjectLiteralExpression(option) ? property(option, "label") : undefined;
            if (value && ts.isStringLiteralLike(value) && optionLabel && ts.isStringLiteralLike(optionLabel)) labels.set(`${code.text}.${key.text}.${value.text}`, optionLabel.text);
            return value && ts.isStringLiteralLike(value) ? [value.text] : [];
          }) : []);
        }
        seeded.set(code.text, keys);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  // These templates are seeded from the shared registry, outside journalTemplates.
  for (const journal of REGISTER_JOURNALS) {
    seeded.set(journal.code, new Map(journal.fields.map(field => [field.key, (field.options ?? []).map(option => option.value)])));
    for (const field of journal.fields) {
      labels.set(`${journal.code}.${field.key}`, field.label);
      for (const option of field.options ?? []) labels.set(`${journal.code}.${field.key}.${option.value}`, option.label);
    }
  }
  for (const locale of ["ru", "en", "uz"] as const) {
    const catalogs = (await loadMessages(locale)).journalFields;
    for (const [code, fields] of Object.entries(catalogs)) {
      const expected = seeded.get(code);
      assert.ok(expected, `Missing seeded journal: ${code}`);
      assert.deepEqual(Object.keys(fields).sort(), [...expected.keys()].sort(), `${locale}/${code}: field coverage`);
      for (const [key, options] of expected) {
        const field = (fields as Record<string, { label: string; options?: Record<string, string> }>)[key];
        assert.deepEqual(Object.keys(field.options ?? {}).sort(), [...options].sort(), `${locale}/${code}/${key}: option coverage`);
        if (locale === "ru") {
          assert.equal(field.label, labels.get(`${code}.${key}`), `${code}.${key}: original label`);
          for (const value of options) assert.equal(field.options?.[value], labels.get(`${code}.${key}.${value}`), `${code}.${key}.${value}: original option label`);
        }
      }
    }
  }
});

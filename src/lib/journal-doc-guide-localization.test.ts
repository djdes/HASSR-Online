/* eslint-disable react/no-children-prop -- Typed createElement providers require children. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { flattenMessages } from "@/i18n/catalog-validation";
import { JournalDocGuideBody } from "@/components/journals/journal-doc-guide-body";
import {
  JOURNAL_DOC_GUIDE_CODES, getJournalDocGuide, hasJournalDocGuide, presentJournalDocGuide,
} from "./journal-doc-guides";
import { DOC_GUIDE_COPY_KEYS, translateDocGuideTree } from "./journal-doc-guide-copy";

function stringLeaves(value: unknown, pointer = ""): Record<string, string> {
  if (typeof value === "string") return { [pointer]: value };
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
    Object.entries(stringLeaves(item, pointer ? `${pointer}.${key}` : key))));
}

function shape(value: unknown): unknown {
  if (typeof value === "string") return "<text>";
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]));
  return value;
}

test("all built-in document guides have complete semantic copy and exact Russian compatibility", async () => {
  assert.deepEqual([...JOURNAL_DOC_GUIDE_CODES].sort(), Object.keys(DOC_GUIDE_COPY_KEYS).sort());
  const baseline = Object.fromEntries([...JOURNAL_DOC_GUIDE_CODES].map(code => [code, structuredClone(getJournalDocGuide(code)!)]));
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const failures: string[] = [];
    const t = createTranslator({ locale, messages, namespace: "journalDocGuides", onError: error => failures.push(error.message) });
    let sourceLeaves = 0;
    for (const code of JOURNAL_DOC_GUIDE_CODES) {
      const original = baseline[code];
      const translated = getJournalDocGuide(code, t)!;
      const source = stringLeaves(original);
      const result = stringLeaves(translated);
      const keys = DOC_GUIDE_COPY_KEYS[code as keyof typeof DOC_GUIDE_COPY_KEYS];
      assert.deepEqual(Object.keys(result), Object.keys(source), `${locale}/${code}: text leaves`);
      assert.deepEqual(Object.keys(keys).sort(), Object.keys(source).sort(), `${code}: mapping coverage`);
      assert.deepEqual(shape(translated), shape(original), `${locale}/${code}: optional fields and order`);
      for (const [pointer, key] of Object.entries(keys)) assert.equal(result[pointer], t(key), `${locale}/${key}`);
      if (locale === "ru") assert.deepEqual(translated, original, `${code}: RU source drift`);
      else for (const [pointer, value] of Object.entries(result)) {
        assert.ok(value.trim(), `${locale}/${code}/${pointer}`);
        assert.doesNotMatch(value, /\p{Script=Cyrillic}/u, `${locale}/${code}/${pointer}`);
      }
      assert.deepEqual(getJournalDocGuide(code), original, `${code}: source mutation`);
      sourceLeaves += Object.keys(source).length;
    }
    assert.equal(sourceLeaves, Object.keys(flattenMessages(messages.journalDocGuides)).length, "catalog contains only inventoried guide text");
    assert.deepEqual(failures, []);
  }
});

test("the real document-guide renderer displays every section and example in all three languages", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const failures: string[] = [];
    const t = createTranslator({ locale, messages, namespace: "journalDocGuides", onError: error => failures.push(error.message) });
    for (const code of JOURNAL_DOC_GUIDE_CODES) {
      const guide = getJournalDocGuide(code, t)!;
      const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
        locale, timeZone: "Europe/Moscow", messages: { journalControls: messages.journalControls, journalDocGuides: messages.journalDocGuides },
        onError: error => failures.push(error.message), children: createElement(JournalDocGuideBody, { guide }),
      }));
      for (const value of Object.values(stringLeaves(guide))) {
        const escaped = renderToStaticMarkup(createElement("span", null, value)).slice(6, -7);
        assert.ok(html.includes(escaped), `${locale}/${code}: missing rendered text ${value}`);
      }
      const labels = messages.journalControls.guideSections;
      assert.ok(html.includes(labels.who) && html.includes(labels.when) && html.includes(labels.steps));
      if (guide.prepare?.length) assert.ok(html.includes(labels.prepare));
      if (guide.examples?.length) assert.ok(html.includes(labels.examples));
      if (guide.mistakes?.length) assert.ok(html.includes(labels.mistakes));
      if (guide.redFlags?.length) assert.ok(html.includes(labels.redFlags));
      if (guide.legalRef) assert.ok(html.includes(labels.regulationLabel));
      if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
    }
    assert.deepEqual(failures, []);
  }
});

test("custom guide objects and unregistered metadata remain untouched, including reused built-in codes", async () => {
  const baseline = getJournalDocGuide("hygiene")!;
  const custom = { ...structuredClone(baseline), intro: "Авторский текст O‘tkir <2026>", source: { id: "customer-123", savedAt: new Date("2026-10-15T00:00:00Z") } };
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages, namespace: "journalDocGuides", onError: error => { throw error; } });
    assert.strictEqual(presentJournalDocGuide("hygiene", custom, t), custom);
    assert.strictEqual(presentJournalDocGuide("custom-guide", custom, t), custom);
    const mapped = translateDocGuideTree(custom, DOC_GUIDE_COPY_KEYS.hygiene, t);
    assert.strictEqual(mapped.source, custom.source, "unregistered metadata must not be rewritten");
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, timeZone: "Europe/Moscow", messages: { journalControls: messages.journalControls },
      onError: error => { throw error; }, children: createElement(JournalDocGuideBody, { guide: presentJournalDocGuide("hygiene", custom, t) }),
    }));
    assert.ok(html.includes("Авторский текст O‘tkir &lt;2026&gt;"));
    for (const code of ["__unknown__", "__proto__", "constructor", "toString"]) {
      assert.equal(getJournalDocGuide(code, t), null);
      assert.equal(hasJournalDocGuide(code), false);
    }
    assert.equal(hasJournalDocGuide("hygiene"), true);
  }
});

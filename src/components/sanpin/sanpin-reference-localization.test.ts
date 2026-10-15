import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SANPIN_NORMS, type SanPinNorm } from "@/lib/sanpin-norms";
import { loadMessages } from "@/i18n/messages";
import { SanpinReferenceView } from "./sanpin-reference-view";
import { presentSanpinNorm, SANPIN_REFERENCE_CATEGORIES } from "./sanpin-reference-presentation";

function escaped(text: string) {
  return renderToStaticMarkup(createElement("span", null, text)).slice(6, -7);
}
const numericTokens = (text: string) => (text.match(/[-+]?\d+(?:[.,]\d+)*/g) ?? []).sort();

test("SanPiN catalog covers every source field by norm ID without changing quantities or regulations", async () => {
  const snapshot = structuredClone(SANPIN_NORMS);
  for (const locale of ["ru", "en", "uz"] as const) {
    const { sanpinReference: messages } = await loadMessages(locale);
    assert.deepEqual(Object.keys(messages.norms).sort(), SANPIN_NORMS.map(norm => norm.id).sort());
    assert.deepEqual(Object.keys(messages.categories).sort(), SANPIN_REFERENCE_CATEGORIES.map(category => category.key).sort());
    for (const source of SANPIN_NORMS) {
      const translated = presentSanpinNorm(source, messages);
      assert.notEqual(translated, source);
      assert.equal(translated.id, source.id);
      assert.equal(translated.category, source.category);
      assert.deepEqual(Object.keys(translated).sort(), Object.keys(source).sort(), `${locale}.${source.id} optional fields`);
      if (locale === "ru") assert.deepEqual(translated, source, `${source.id} source fidelity`);
      for (const key of ["title", "description", "section", "document", "values", "penalty"] as const) {
        if (source[key] === undefined) {
          assert.equal(translated[key], undefined);
          continue;
        }
        const text = translated[key]!;
        assert.ok(text.trim());
        assert.deepEqual(numericTokens(text), numericTokens(source[key]!), `${locale}.${source.id}.${key} numeric invariants`);
        assert.equal((text.match(/°C/g) ?? []).length, (source[key]!.match(/°C/g) ?? []).length, `${locale}.${source.id}.${key} Celsius units`);
        assert.deepEqual((text.match(/[≤≥]/g) ?? []).sort(), (source[key]!.match(/[≤≥]/g) ?? []).sort(), `${locale}.${source.id}.${key} limit direction`);
        if (locale !== "ru") assert.doesNotMatch(text.replaceAll("29н", "29n"), /\p{Script=Cyrillic}/u, `${locale}.${source.id}.${key}`);
      }
      if (source.penalty) assert.match(translated.penalty!, locale === "ru" ? /руб/ : locale === "en" ? /RUB/ : /rubl/);
    }
  }
  assert.deepEqual(SANPIN_NORMS, snapshot, "rendering must never alter source norms");
});

test("complete SanPiN reference renders all 28 norms in RU/EN/UZ using actual translated copy", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const { sanpinReference: messages } = await loadMessages(locale);
    const html = renderToStaticMarkup(createElement(SanpinReferenceView, { locale, messages }));
    assert.ok(html.includes(escaped(messages.title)));
    assert.ok(html.includes(escaped(messages.description)));
    assert.equal((html.match(/data-norm-id=/g) ?? []).length, SANPIN_NORMS.length);
    for (const source of SANPIN_NORMS) {
      const norm = presentSanpinNorm(source, messages);
      assert.ok(html.includes(`data-norm-id="${source.id}"`));
      for (const text of [norm.title, norm.description, norm.document, norm.section, norm.values, norm.penalty]) {
        if (text) assert.ok(html.includes(escaped(text)), `${locale}.${source.id}: ${text}`);
      }
    }
    if (locale !== "ru") assert.doesNotMatch(html.replaceAll("29н", "29n"), /\p{Script=Cyrillic}/u);
  }
});

test("unknown reference entries preserve their original text and metadata", async () => {
  const { sanpinReference: messages } = await loadMessages("uz");
  const source: SanPinNorm = {
    id: "custom-id", category: "general", title: "Custom <norm>", description: "Авторский текст", section: "Original section", document: "Custom document 777", values: "≤ +9°C",
  };
  assert.deepEqual(presentSanpinNorm(source, messages), source);
  assert.deepEqual(presentSanpinNorm({ ...source, id: "__proto__" }, messages), { ...source, id: "__proto__" });
  const html = renderToStaticMarkup(createElement(SanpinReferenceView, { locale: "uz", messages, norms: [source] }));
  assert.ok(html.includes("Custom &lt;norm&gt;"));
  assert.ok(html.includes("Авторский текст"));
  assert.equal((html.match(/data-norm-id=/g) ?? []).length, 1);
});

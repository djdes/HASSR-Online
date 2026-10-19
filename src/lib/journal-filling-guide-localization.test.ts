/* eslint-disable react/no-children-prop -- Explicit provider children for SSR tests. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { flattenMessages } from "@/i18n/catalog-validation";
import { JournalGuide } from "@/components/journals/journal-guide";
import { TaskFillHelperModal } from "@/components/task-fill/task-fill-helper-modal";
import { FILLING_GUIDES, getFillingGuide, presentFillingGuide } from "./journal-filling-guides";
import { FILLING_GUIDE_COPY_KEYS, getSharedFillingGuideCopyKeys, translateFillingGuideTree } from "./journal-filling-guide-copy";

function leaves(value: unknown, pointer = ""): Record<string, string> {
  if (typeof value === "string") return { [pointer]: value };
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
    Object.entries(leaves(item, pointer ? `${pointer}.${key}` : key))));
}

const baseline = structuredClone(FILLING_GUIDES);

test("46 complete filling guides use 488 own and 336 shared semantic messages with exact Russian compatibility", async () => {
  assert.equal(Object.keys(baseline).length, 46);
  assert.deepEqual(Object.keys(FILLING_GUIDE_COPY_KEYS).sort(), Object.keys(baseline).sort());
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const failures: string[] = [];
    const onError = (error: Error) => failures.push(error.message);
    const t = {
      guide: createTranslator({ locale, messages, namespace: "journalFillingGuides", onError }),
      walkthrough: createTranslator({ locale, messages, namespace: "journalControls.walkthroughs", onError }),
    };
    let ownCount = 0;
    let sharedCount = 0;
    for (const code of Object.keys(FILLING_GUIDE_COPY_KEYS) as Array<keyof typeof FILLING_GUIDE_COPY_KEYS>) {
      const source = baseline[code];
      const translated = getFillingGuide(code, t)!;
      const own = FILLING_GUIDE_COPY_KEYS[code];
      const shared = getSharedFillingGuideCopyKeys(code);
      const originalLeaves = leaves(source);
      const translatedLeaves = leaves(translated);
      assert.deepEqual(Object.keys(translatedLeaves), Object.keys(originalLeaves), `${code}: shape and order`);
      assert.deepEqual([...Object.keys(own), ...Object.keys(shared)].sort(), Object.keys(originalLeaves).sort(), `${code}: complete disjoint mappings`);
      for (const [pointer, key] of Object.entries(own)) assert.equal(translatedLeaves[pointer], t.guide(key));
      for (const [pointer, key] of Object.entries(shared)) {
        assert.ok(key, `${code}/${pointer}: shared key must exist`);
        assert.equal(translatedLeaves[pointer], t.walkthrough(key));
      }
      if (locale === "ru") assert.deepEqual(translated, source, `${code}: source or semantic mapping drift`);
      else for (const [pointer, value] of Object.entries(translatedLeaves)) {
        assert.ok(value.trim(), `${locale}/${code}/${pointer}`);
        assert.doesNotMatch(value, /\p{Script=Cyrillic}/u, `${locale}/${code}/${pointer}`);
      }
      ownCount += Object.keys(own).length;
      sharedCount += Object.keys(shared).length;
    }
    assert.equal(ownCount, 488);
    assert.equal(sharedCount, 336);
    assert.equal(Object.keys(flattenMessages(messages.journalFillingGuides)).length, ownCount);
    assert.deepEqual(FILLING_GUIDES, baseline, "source data was not mutated");
    assert.deepEqual(failures, []);
  }
});

test("real filling-guide components render every section in all locales", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const onError = (error: Error) => { throw error; };
    const t = {
      guide: createTranslator({ locale, messages, namespace: "journalFillingGuides", onError }),
      walkthrough: createTranslator({ locale, messages, namespace: "journalControls.walkthroughs", onError }),
    };
    for (const code of Object.keys(baseline)) {
      const guide = getFillingGuide(code, t)!;
      for (const child of [
        createElement(JournalGuide, { journalCode: code, expanded: true }),
        createElement(TaskFillHelperModal, { journalCode: code, journalLabel: "Custom O‘tkir", open: true, onClose() {} }),
      ]) {
        const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
          locale, messages: { journalControls: messages.journalControls, journalFillingGuides: messages.journalFillingGuides },
          timeZone: "Europe/Moscow", onError, children: child,
        }));
        for (const [pointer, value] of Object.entries(leaves(guide))) {
          const escaped = renderToStaticMarkup(createElement("span", {}, value)).slice(6, -7);
          assert.ok(html.includes(escaped), `${locale}/${code}/${pointer}: real renderer omitted content`);
        }
        if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u, `${locale}/${code}: untranslated chrome or guide`);
      }
    }
  }
});

test("custom instructions, metadata and links stay exact; unknown codes are safe", async () => {
  const messages = await loadMessages("en");
  const t = {
    guide: createTranslator({ locale: "en", messages, namespace: "journalFillingGuides" }),
    walkthrough: createTranslator({ locale: "en", messages, namespace: "journalControls.walkthroughs" }),
  };
  const custom = { ...structuredClone(baseline.cleaning), summary: "Своя инструкция O‘tkir", metadata: { created: new Date("2026-01-01"), code: "do-not-translate" } };
  assert.equal(presentFillingGuide("cleaning", custom, t), custom, "customer object using built-in code");
  assert.equal(presentFillingGuide("custom", custom, t), custom);
  const copied = translateFillingGuideTree(custom, "cleaning", t);
  assert.equal(copied.metadata, custom.metadata, "unregistered metadata retained by identity");
  for (const code of ["unknown", "constructor", "toString", "__proto__"]) {
    assert.equal(getFillingGuide(code, t), null);
    assert.deepEqual(getSharedFillingGuideCopyKeys(code), {});
  }
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale: "en", messages: { journalControls: messages.journalControls, journalFillingGuides: messages.journalFillingGuides },
    timeZone: "Europe/Moscow", onError: error => { throw error; },
    children: createElement(JournalGuide, {
      journalCode: "cleaning", expanded: true,
      customNodes: [{ title: "Своя инструкция O‘tkir", detail: "Оригинальные указания", photoUrl: "/custom-photo?id=keep" }],
    }),
  }));
  assert.ok(html.includes("Своя инструкция O‘tkir") && html.includes("Оригинальные указания"));
  assert.ok(html.includes('href="/custom-photo?id=keep"'));
  assert.ok(!html.includes(getFillingGuide("cleaning", t)!.steps[0].title), "custom steps replace built-in steps");
  assert.deepEqual(FILLING_GUIDES, baseline);
});

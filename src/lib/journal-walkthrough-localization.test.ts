/* eslint-disable react/no-children-prop -- Typed createElement providers require children. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { FILLING_GUIDES } from "./journal-filling-guides";
import {
  WALKTHROUGH_CODES, getJournalWalkthrough, getJournalWalkthroughOrGeneric,
  hasJournalWalkthrough, visibleWalkthroughSteps,
  type WalkthroughPreviewKey,
} from "./journal-ui-walkthroughs";
import { FILLING_GUIDE_WALKTHROUGH_COPY_KEYS } from "./journal-walkthrough-copy";
import { WalkthroughPreview } from "@/components/journals/walkthrough-previews";

test("every built-in walkthrough and fallback localizes without changing navigation or source data", async () => {
  const codes = [...WALKTHROUGH_CODES, "__custom_journal__"];
  const baseline = codes.map(code => structuredClone(getJournalWalkthroughOrGeneric(code)));
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const failures: string[] = [];
    const t = createTranslator({ locale, messages, namespace: "journalControls.walkthroughs", onError: error => failures.push(error.message) });
    for (const [index, code] of codes.entries()) {
      const steps = getJournalWalkthroughOrGeneric(code, t);
      const original = baseline[index];
      assert.deepEqual(steps.map(step => ({ ...step, title: undefined, body: undefined })),
        original.map(step => ({ ...step, title: undefined, body: undefined })), `${locale}/${code}: navigation`);
      if (locale === "ru") assert.deepEqual(steps, original, `${code}: RU compatibility`);
      else {
        for (const [stepIndex, step] of steps.entries()) {
          assert.doesNotMatch(step.title + step.body, /\p{Script=Cyrillic}/u, `${locale}/${code}/${step.id}`);
          assert.notEqual(step.title, original[stepIndex].title);
          assert.notEqual(step.body, original[stepIndex].body);
          assert.ok(step.title.trim() && step.body.trim());
          // Existing numerical limits, durations and dates must survive translation.
          const numbers = (value: string) => (value.match(/\d+/g) ?? []).sort();
          assert.deepEqual(numbers(step.body), numbers(original[stepIndex].body), `${locale}/${code}/${step.id}: numbers`);
        }
      }
      for (const isMobile of [false, true]) {
        assert.deepEqual(visibleWalkthroughSteps(steps, { isMobile }).map(step => step.id),
          visibleWalkthroughSteps(original, { isMobile }).map(step => step.id));
      }
      assert.deepEqual(getJournalWalkthroughOrGeneric(code), original, `${code}: source mutated`);
    }
    assert.deepEqual(failures, []);
  }
});

test("semantic projection covers every displayed filling-guide source step", async () => {
  const messages = await loadMessages("ru");
  const t = createTranslator({ locale: "ru", messages, namespace: "journalControls.walkthroughs", onError: error => { throw error; } });
  for (const [code, keys] of Object.entries(FILLING_GUIDE_WALKTHROUGH_COPY_KEYS)) {
    const sourceSteps = FILLING_GUIDES[code].steps.slice(0, 4);
    assert.equal(keys.length, sourceSteps.length, code);
    assert.equal(new Set(keys).size, keys.length, code);
    keys.forEach((key, index) => {
      assert.equal(t(`${key}.title`), sourceSteps[index].title);
      assert.equal(t(`${key}.body`), sourceSteps[index].detail);
    });
  }
});

test("custom guides and unknown codes preserve text and never resolve inherited object properties", async () => {
  const original = FILLING_GUIDES.cleaning;
  const customStep = { title: "Мой заголовок O‘tkir", detail: "Авторская инструкция <2026> — сохраняется" };
  try {
    FILLING_GUIDES.__custom__ = { ...original, steps: [customStep] };
    FILLING_GUIDES.cleaning = { ...original, steps: [customStep] };
    for (const locale of ["ru", "en", "uz"] as const) {
      const messages = await loadMessages(locale);
      const t = createTranslator({ locale, messages, namespace: "journalControls.walkthroughs", onError: error => { throw error; } });
      for (const code of ["__custom__", "cleaning"]) {
        const steps = getJournalWalkthrough(code, t)!;
        const projected = steps.find(step => step.id === "guide-1");
        assert.equal(projected?.title, customStep.title);
        assert.equal(projected?.body, customStep.detail);
        assert.equal(hasJournalWalkthrough(code), true);
      }
      for (const code of ["__unknown__", "__proto__", "constructor", "toString"]) {
        assert.equal(getJournalWalkthrough(code, t), null);
        assert.equal(hasJournalWalkthrough(code), false);
        assert.equal(getJournalWalkthroughOrGeneric(code, t)[0].title, t("generic.create-document.title"));
      }
    }
  } finally {
    FILLING_GUIDES.cleaning = original;
    delete FILLING_GUIDES.__custom__;
  }
});

test("all seven real preview components render selected-language copy and retain technical sample values", async () => {
  const previews: WalkthroughPreviewKey[] = ["button-create", "button-add", "status-cycle", "temp-toggle", "button-add-room", "button-add-row", "measure-cells"];
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const failures: string[] = [];
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, timeZone: "Europe/Moscow", messages: { journalControls: messages.journalControls },
      onError: error => failures.push(error.message),
      children: previews.map(preview => createElement(WalkthroughPreview, { key: preview, preview })),
    }));
    assert.deepEqual(failures, []);
    for (const text of Object.values(messages.journalControls.walkthroughs.previews)) assert.ok(html.includes(text), `${locale}/${text}`);
    assert.equal((html.match(/<div aria-hidden="true"/g) ?? []).length, previews.length);
    assert.ok(html.includes("21.5") && html.includes("82") && html.includes("T, °C"));
    if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
  }
});

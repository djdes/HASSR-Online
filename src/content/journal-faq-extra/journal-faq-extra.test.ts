import assert from "node:assert/strict";
import test from "node:test";

import { JOURNAL_INFO } from "@/content/journal-info";
import { JOURNAL_FAQ_EXTRA } from "@/content/journal-faq-extra";

const CYRILLIC = /[А-Яа-яЁё]/;
const LOCALES = (process.env.FAQ_LOCALES?.split(",") ?? ["ru", "en", "uz"]) as Array<"ru" | "en" | "uz">;
const ONLY = process.env.FAQ_ONLY?.split(",").filter(Boolean);

for (const locale of LOCALES) {
  for (const code of Object.keys(JOURNAL_INFO).filter((code) => !ONLY || ONLY.includes(code))) {
    test(`journal faq extra ${locale}: ${code}`, () => {
      const items = JOURNAL_FAQ_EXTRA[locale][code];
      assert.ok(items, `${locale}/${code}: нет вопросов`);
      assert.ok(items.length >= 3 && items.length <= 5, `${locale}/${code}: вопросов ${items.length}, нужно 3–5`);
      const ru = JOURNAL_FAQ_EXTRA.ru[code];
      if (locale !== "ru") {
        assert.equal(items.length, ru.length, `${locale}/${code}: число вопросов не как в ru`);
        assert.doesNotMatch(JSON.stringify(items), CYRILLIC, `${locale}/${code}: кириллица`);
      }
      for (const item of items) {
        assert.ok(item.q.endsWith("?"), `${locale}/${code}: вопрос без «?»: ${item.q}`);
        assert.ok(item.a.length >= 120 && item.a.length <= 700, `${locale}/${code}: длина ответа ${item.a.length}: ${item.q}`);
      }
      assert.equal(new Set(items.map((item) => item.q)).size, items.length, `${locale}/${code}: повтор вопроса`);
      assert.doesNotMatch(JSON.stringify(items), /3590-20/, `${locale}/${code}: устаревший СанПиН`);
    });
  }
}

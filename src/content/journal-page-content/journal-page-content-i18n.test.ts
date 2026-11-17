import assert from "node:assert/strict";
import test from "node:test";

import {
  JOURNAL_PAGE_CONTENT,
  JOURNAL_PAGE_CONTENT_EN,
  JOURNAL_PAGE_CONTENT_UZ,
  type JournalPageContent,
} from "@/content/journal-page-content";

/**
 * en/uz — перевод русских блоков (спека journal-page-content-i18n-2026-11):
 * та же форма (колонки, строки, разделы, пункты) и те же числа в штрафах —
 * статьи и суммы КоАП не должны «поплыть» при переводе.
 */

/** Числа пункта без разделителей разрядов, по возрастанию: «20 000» = «20,000». */
function numbers(text: string): string[] {
  return (text.match(/\d+(?:[ ,  ]\d{3})*/g) ?? []).map((value) => value.replace(/[ ,  ]/g, "")).sort();
}

const CYRILLIC = /[А-Яа-яЁё]/;

const ONLY = process.env.JOURNAL_CONTENT_ONLY?.split(",").filter(Boolean);
const LOCALES = (process.env.JOURNAL_CONTENT_LOCALES?.split(",") ?? ["en", "uz"]) as Array<"en" | "uz">;

for (const locale of LOCALES) {
  const table: Record<string, JournalPageContent> = locale === "en" ? JOURNAL_PAGE_CONTENT_EN : JOURNAL_PAGE_CONTENT_UZ;
  for (const code of Object.keys(JOURNAL_PAGE_CONTENT).filter((code) => !ONLY || ONLY.includes(code))) {
    test(`journal page content ${locale}: ${code}`, () => {
      const ru = JOURNAL_PAGE_CONTENT[code];
      const tr = table[code];
      assert.ok(tr, `${locale}/${code}: нет перевода`);
      assert.ok(ru.sample && tr.sample, `${locale}/${code}: нет образца`);
      assert.equal(tr.sample.columns.length, ru.sample.columns.length, `${locale}/${code}: другое число колонок`);
      assert.equal(tr.sample.rows.length, ru.sample.rows.length, `${locale}/${code}: другое число строк`);
      tr.sample.rows.forEach((row, index) => assert.equal(row.length, ru.sample!.rows[index].length, `${locale}/${code}: строка ${index + 1}`));

      const ruSections = ru.sections ?? [];
      const trSections = tr.sections ?? [];
      assert.equal(trSections.length, ruSections.length, `${locale}/${code}: другое число разделов`);
      trSections.forEach((section, index) => {
        assert.equal(section.paragraphs?.length ?? 0, ruSections[index].paragraphs?.length ?? 0, `${locale}/${code}: абзацы раздела ${index + 1}`);
        assert.equal(section.bullets?.length ?? 0, ruSections[index].bullets?.length ?? 0, `${locale}/${code}: пункты раздела ${index + 1}`);
      });

      assert.ok(ru.fines && tr.fines, `${locale}/${code}: нет штрафов`);
      assert.equal(tr.fines.items.length, ru.fines.items.length, `${locale}/${code}: другое число штрафов`);
      tr.fines.items.forEach((item, index) =>
        assert.deepEqual(numbers(item), numbers(ru.fines!.items[index]), `${locale}/${code}: числа штрафа ${index + 1} не совпадают: ${item}`),
      );

      // Перевод, а не копия: кириллицы быть не должно (кроме названий средств в кавычках не допускаем вовсе).
      assert.doesNotMatch(JSON.stringify(tr), CYRILLIC, `${locale}/${code}: осталась кириллица`);
    });
  }
}

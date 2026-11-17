import assert from "node:assert/strict";
import test from "node:test";

import { JOURNAL_INFO } from "@/content/journal-info";
import { JOURNAL_PAGE_CONTENT, type JournalPageContent } from "@/content/journal-page-content";

/**
 * Каждый журнал каталога получает блоки страницы (спека
 * journal-page-content-all-2026-11): образец строками, 4–6 разделов,
 * штрафы. Тест держит форму и объём, чтобы страница не вышла пустой или
 * раздутой.
 */

function words(content: JournalPageContent): number {
  const parts = [
    content.sample?.caption ?? "",
    ...(content.sample?.columns ?? []),
    ...(content.sample?.rows.flat() ?? []),
    ...(content.sections ?? []).flatMap((section) => [section.heading, ...(section.paragraphs ?? []), ...(section.bullets ?? [])]),
    content.fines?.intro ?? "",
    ...(content.fines?.items ?? []),
    content.fines?.note ?? "",
  ];
  return parts.join(" ").match(/[А-Яа-яЁёA-Za-z0-9]+/g)?.length ?? 0;
}

/**
 * Проверенные суммы КоАП РФ (редакция на ноябрь 2026): пункт со знаком ₽
 * обязан назвать одну из этих статей и её суммы дословно. Статья без сумм
 * (например, ст. 19.19) допустима.
 */
const APPROVED_FINES: Record<string, string> = {
  "6.6": "для юрлиц от 20 000 до 40 000 ₽ или приостановление деятельности до 90 суток",
  "6.3": "для юрлиц от 10 000 до 20 000 ₽ или приостановление деятельности до 90 суток",
  "6.4": "для юрлиц от 10 000 до 20 000 ₽ или приостановление деятельности до 90 суток",
  "14.43": "для ИП от 20 000 до 30 000 ₽, для юрлиц от 100 000 до 300 000 ₽",
  "5.27.1 ч. 1": "для должностных лиц и ИП от 2 000 до 5 000 ₽, для юрлиц от 50 000 до 80 000 ₽",
  "5.27.1 ч. 3": "для должностных лиц и ИП от 15 000 до 25 000 ₽, для юрлиц от 110 000 до 130 000 ₽",
  "5.27.1 ч. 4": "для должностных лиц и ИП от 20 000 до 30 000 ₽, для юрлиц от 130 000 до 150 000 ₽",
  "8.2 ч. 1": "для юрлиц от 100 000 до 250 000 ₽ или приостановление деятельности до 90 суток",
  "14.4 ч. 1": "для юрлиц от 20 000 до 30 000 ₽",
};

function checkFineItem(code: string, item: string) {
  if (!item.includes("₽")) return;
  const article = item.match(/^ст\. (\d+(?:\.\d+)*(?: ч\. \d+)?) КоАП РФ/)?.[1];
  assert.ok(article && APPROVED_FINES[article], `${code}: штраф по непроверенной статье: ${item}`);
  assert.ok(item.includes(APPROVED_FINES[article]), `${code}: суммы ст. ${article} не совпадают с проверенными: ${item}`);
}

const ONLY = process.env.JOURNAL_CONTENT_ONLY?.split(",").filter(Boolean);

for (const code of Object.keys(JOURNAL_INFO).filter((code) => !ONLY || ONLY.includes(code))) {
  test(`journal page content: ${code}`, () => {
    const content = JOURNAL_PAGE_CONTENT[code];
    assert.ok(content, `${code}: нет блоков страницы`);

    const sample = content.sample;
    assert.ok(sample, `${code}: нет образца заполнения`);
    assert.ok(sample.columns.length >= 3 && sample.columns.length <= 8, `${code}: колонок ${sample.columns.length}, нужно 3–8`);
    assert.ok(sample.rows.length >= 3 && sample.rows.length <= 6, `${code}: строк ${sample.rows.length}, нужно 3–6`);
    for (const row of sample.rows) assert.equal(row.length, sample.columns.length, `${code}: строка не совпадает с колонками: ${row.join(" | ")}`);
    assert.ok(sample.caption.length >= 60, `${code}: подпись образца слишком короткая`);

    const sections = content.sections ?? [];
    assert.ok(sections.length >= 4 && sections.length <= 6, `${code}: разделов ${sections.length}, нужно 4–6`);
    assert.equal(new Set(sections.map((section) => section.heading)).size, sections.length, `${code}: повторяются заголовки`);
    for (const section of sections) {
      assert.ok((section.paragraphs?.length ?? 0) + (section.bullets?.length ?? 0) > 0, `${code}: пустой раздел «${section.heading}»`);
      assert.ok(section.heading.length <= 80, `${code}: длинный заголовок «${section.heading}»`);
    }

    assert.ok(content.fines, `${code}: нет блока штрафов`);
    assert.ok(content.fines.items.length >= 1 && content.fines.items.length <= 4, `${code}: пунктов штрафов ${content.fines.items.length}`);
    for (const item of content.fines.items) checkFineItem(code, item);

    const total = words(content);
    assert.ok(total >= 380 && total <= 900, `${code}: ${total} слов, нужно 380–900`);

    const text = JSON.stringify(content);
    assert.doesNotMatch(text, /TODO|lorem|XXX|\{\{|\bundefined\b/i, `${code}: заготовка в тексте`);
    // Нормы — только те, что действуют на сайте; старый СанПиН 2.3/2.4.3590-20 заменён.
    assert.doesNotMatch(text, /3590-20/, `${code}: устаревший СанПиН 2.3/2.4.3590-20`);
  });
}

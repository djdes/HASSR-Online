import assert from "node:assert/strict";
import test from "node:test";

import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import JSZip from "jszip";

import { renderJournalDocumentDocx } from "@/lib/document-docx";
import { COVER_BLANK_ORGANIZATION, JOURNAL_COVERS, blankJournalCover, coverDate, coverTitleLines, journalCover } from "@/lib/journal-cover-pdf";
import { buildJournalBlankInput, buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { renderPaperJournalPdf } from "@/lib/paper-journal-pdf";
import { PAPER_JOURNALS } from "@/lib/sphere-journal-rules";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

async function pages(bytes: Buffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const pdf = await task.promise;
    const out: string[] = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const content = await (await pdf.getPage(i)).getTextContent();
      out.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " "));
    }
    return out;
  } finally {
    await task.destroy();
  }
}

test("титульник: 11 журналов из образцов владельца, СанПиН-приложения 1–5", () => {
  assert.equal(Object.keys(JOURNAL_COVERS).length, 11);
  assert.equal(journalCover("hygiene")?.appendix, "Приложение N 1");
  assert.equal(journalCover("perishable_rejection")?.appendix, "Приложение N 5");
  assert.equal(journalCover("cleaning"), null);
  assert.deepEqual(coverDate(null), { day: "\"___\" __________", year: "20___ г." });
  assert.deepEqual(coverDate(new Date("2026-11-11T22:00:00Z")), { day: "\"12\" ноября", year: "2026 г." });
});

test("титульник — первой страницей при печати, бланк и его нумерация не меняются", async () => {
  const input = buildJournalSampleInput("hygiene");
  const plain = await pages(renderJournalDocumentPdf(input).buffer);
  const withCover = await pages(renderJournalDocumentPdf({ ...input, cover: true }).buffer);
  assert.equal(withCover.length, plain.length + 1);
  assert.match(withCover[0], /ГИГИЕНИЧЕСКИЙ ЖУРНАЛ/);
  assert.match(withCover[0], /Приложение N 1/);
  assert.match(withCover[0], /Ответственный за ведение журнала/);
  assert.match(withCover[0], /Журнал начат/);
  assert.ok(!/СТР\. 1 ИЗ/i.test(withCover[0]), "у титульника нет номера страницы");
  assert.equal(withCover[1], plain[0]);
  // Журнал без титульника и другой язык — как раньше.
  assert.equal((await pages(renderJournalDocumentPdf({ ...buildJournalSampleInput("cleaning"), cover: true }).buffer)).length, (await pages(renderJournalDocumentPdf(buildJournalSampleInput("cleaning")).buffer)).length);
  assert.equal((await pages(renderJournalDocumentPdf({ ...input, cover: true, locale: "en" }).buffer)).length, (await pages(renderJournalDocumentPdf({ ...input, locale: "en" }).buffer)).length);
});

// Бланк с сайта: галка «Добавить титульный лист» в окне скачивания (спека
// blank-download-seal-cover-captcha-2026-11-20).
test("титульник бланка: свои строки у журналов из списка, у остальных — название по словам", () => {
  assert.equal(blankJournalCover("hygiene", "что угодно"), JOURNAL_COVERS.hygiene);
  assert.deepEqual(blankJournalCover(null, "Журнал уборки"), { lines: ["Журнал уборки"] });
  const lines = coverTitleLines("Журнал регистрации инструктажей (информирования) работников по охране труда");
  assert.ok(lines.length >= 2 && lines.every((line) => line.length <= 34), lines.join(" | "));
  assert.equal(lines.join(" "), "Журнал регистрации инструктажей (информирования) работников по охране труда");
});

test("титульник бланка в PDF журнала: организация из окна, пустые даты, у любого журнала", async () => {
  const company = "ООО «Ромашка»";
  const input = buildJournalBlankInput("cleaning", { company });
  const plain = await pages(renderJournalDocumentPdf(input).buffer);
  const withCover = await pages(renderJournalDocumentPdf({ ...input, blankCover: { organization: company, responsibleName: "Иванова А. П." } }).buffer);
  assert.equal(withCover.length, plain.length + 1);
  assert.ok(withCover[0].includes(company), withCover[0]);
  assert.ok(withCover[0].includes("Иванова А. П."), "ответственный из «Дополнительно»");
  assert.match(withCover[0], /Журнал начат "___" __________ 20___ г\./);
  assert.match(withCover[0], /Журнал окончен "___" __________ 20___ г\./);
  assert.equal(withCover[1], plain[0], "бланк после титульника — как был");
  // Без компании — пустая строка под запись; журнал из списка — его строки.
  const hygiene = await pages(renderJournalDocumentPdf({ ...buildJournalBlankInput("hygiene"), blankCover: {} }).buffer);
  assert.ok(hygiene[0].includes(COVER_BLANK_ORGANIZATION), hygiene[0]);
  assert.match(hygiene[0], /ГИГИЕНИЧЕСКИЙ ЖУРНАЛ/);
  // Титульник русский: на en файл без него.
  const en = buildJournalBlankInput("cleaning", {});
  assert.equal(
    (await pages(renderJournalDocumentPdf({ ...en, locale: "en", blankCover: {} }).buffer)).length,
    (await pages(renderJournalDocumentPdf({ ...en, locale: "en" }).buffer)).length,
  );
});

test("титульник бланка в PDF бумажного журнала и в Word", async () => {
  const journal = PAPER_JOURNALS[0];
  const organization = { name: "Организация", inn: null, address: null };
  const plain = await pages(renderPaperJournalPdf({ journal, organization }));
  const withCover = await pages(renderPaperJournalPdf({ journal, organization, cover: { organization: "ИП Петров" } }));
  assert.equal(withCover.length, plain.length + 1);
  assert.ok(withCover[0].includes("ИП Петров"), withCover[0]);
  assert.match(withCover[0], /Ответственный за ведение журнала/);
  assert.equal(withCover[1], plain[0]);

  const input = buildJournalBlankInput("hygiene", { company: "ООО «Ромашка»" });
  const xml = async (buffer: Buffer) => (await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string"));
  const docPlain = await xml((await renderJournalDocumentDocx(input, "hygiene")).buffer);
  const docCover = await xml((await renderJournalDocumentDocx(input, "hygiene", {
    cover: { cover: blankJournalCover("hygiene", input.document.title), blank: { organization: "ООО «Ромашка»" } },
  })).buffer);
  const sections = (value: string) => (value.match(/<w:sectPr/g) ?? []).length;
  assert.equal(sections(docCover), sections(docPlain) + 1, "титульник — отдельный раздел перед бланком");
  for (const text of ["ГИГИЕНИЧЕСКИЙ ЖУРНАЛ", "Приложение N 1", "Ответственный за ведение журнала", "Журнал начат", "ООО «Ромашка»"]) {
    assert.ok(docCover.includes(text.replace(/"/g, "&quot;")), text);
  }
  assert.ok(!docPlain.includes("Журнал начат"));
});


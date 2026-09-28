import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { jsPDF } from "jspdf";
import JSZip from "jszip";

import { DOCX_FONT, renderJournalDocumentDocx } from "@/lib/document-docx";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { journalSamplePdfQr } from "@/lib/journal-pdf-qr-link";
import { SAMPLE_ORGANIZATION, buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { renderPaperJournalPdf } from "@/lib/paper-journal-pdf";
import {
  JOURNAL_FONT_NAME,
  journalPrintableText,
  registerJournalUnicodeFont,
  resolveJournalFontFiles,
} from "@/lib/pdf-journal-font";
import { JOURNAL_CAP_HEIGHT_EM, JOURNAL_DESCENT_EM } from "@/lib/pdf-journal-sheet";
import { journalAutoTable } from "@/lib/pdf-journal-table";
import { buildRegulatorCoverPdf } from "@/lib/regulator-bundle";
import { PAPER_JOURNALS } from "@/lib/sphere-journal-rules";

/**
 * Шрифт печатных журналов (2026-09-28, владелец: «Times New Roman был бы
 * изящнее»): PDF — Liberation Serif 2.1.5 (метрически Times New Roman, OFL),
 * Word — Times New Roman. Файлы шрифта — без изменений из официального релиза.
 */

const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf-fonts");
/** sha256 файлов релиза github.com/liberationfonts/liberation-fonts 2.1.5 (liberation-fonts-ttf-2.1.5.tar.gz). */
const RELEASE_SHA256: Record<string, string> = {
  "LiberationSerif-Regular.ttf": "058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74",
  "LiberationSerif-Bold.ttf": "d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce",
};

const sha256 = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Шрифты, встроенные в PDF jsPDF: имя семейства → высота прописных из FontDescriptor (единицы 1/2048 em). */
function embeddedFonts(pdf: Buffer): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of pdf.toString("latin1").matchAll(/\/FontName \/([^\s/]+)[\s\S]*?\/CapHeight (\d+)/g)) {
    out.set(m[1], Number(m[2]));
  }
  return out;
}

test("шрифт журналов — Liberation Serif из репозитория, файлы — ровно как в релизе, лицензия рядом", () => {
  const files = resolveJournalFontFiles();
  assert.equal(files.regular, path.join(FONT_DIR, "LiberationSerif-Regular.ttf"));
  assert.equal(files.bold, path.join(FONT_DIR, "LiberationSerif-Bold.ttf"));
  for (const [name, hash] of Object.entries(RELEASE_SHA256)) {
    assert.equal(sha256(path.join(FONT_DIR, name)), hash, name);
  }
  const license = fs.readFileSync(path.join(FONT_DIR, "LICENSE-LiberationSerif.txt"), "utf8");
  assert.match(license, /SIL Open Font License/);
  // Метрики вёрстки — от этого шрифта (прописные 1341/2048, выносные 442/2048).
  assert.ok(Math.abs(JOURNAL_CAP_HEIGHT_EM - 1341 / 2048) < 0.002);
  assert.ok(Math.abs(JOURNAL_DESCENT_EM - 442 / 2048) < 0.002);
});

test("PDF журнала: текст — Liberation Serif (обычный и жирный), «Отсканировать» в плитке QR — свой DejaVu Sans Bold", () => {
  const { buffer } = renderJournalDocumentPdf({
    ...buildJournalSampleInput("hygiene"),
    qr: journalSamplePdfQr("https://wesetup.ru", "hygiene"),
  });
  const fonts = embeddedFonts(buffer);
  assert.equal(fonts.get(JOURNAL_FONT_NAME), 1341, "JournalUnicode — прописные Liberation Serif");
  assert.ok(fonts.has("WeSetupQrBold"), "слово в полосе QR — DejaVu Sans Bold");
  assert.deepEqual([...fonts.keys()].sort(), [JOURNAL_FONT_NAME, "WeSetupQrBold"].sort());
});

test("бумажный бланк и обложка пакета для проверки — тем же шрифтом, что журналы", () => {
  const paper = renderPaperJournalPdf({ journal: PAPER_JOURNALS[0], organization: SAMPLE_ORGANIZATION });
  assert.equal(embeddedFonts(paper).get(JOURNAL_FONT_NAME), 1341);
  const cover = buildRegulatorCoverPdf({
    organizationName: "ООО «Ромашка»",
    periodFrom: new Date("2026-09-01T00:00:00Z"),
    periodTo: new Date("2026-09-28T00:00:00Z"),
    generatedAt: new Date("2026-09-28T12:00:00Z"),
    journalsIncluded: 12,
    journalsFailed: 0,
    capaOpen: 1,
    capaClosed: 2,
    temperatureAnomalies: 0,
    preparedBy: "Иванова М. П.",
  });
  assert.equal(embeddedFonts(cover).get(JOURNAL_FONT_NAME), 1341);
});

test("знаков, которых нет в Liberation Serif, в печати нет: ✓ ✗ ₽ → близкие", () => {
  assert.equal(journalPrintableText("✓ 12.03"), "√ 12.03");
  assert.equal(journalPrintableText("✔ ✗ ✘"), "√ × ×");
  assert.equal(journalPrintableText("150 ₽"), "150 руб.");
  assert.equal(journalPrintableText("Иванов И. И. — 5 °C, № 3"), "Иванов И. И. — 5 °C, № 3");
  // В таблице бланка замена — до разметки: ширина графы считается по тому, что напечатано.
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const font = registerJournalUnicodeFont(doc);
  const drawn: string[] = [];
  journalAutoTable(doc, {
    styles: { font, fontSize: 8 },
    head: [["Тема", "Отметка"]],
    body: [["Санитария", "✓ 01.26"]],
    didDrawCell: (data) => {
      if (data.section === "body") drawn.push(data.cell.text.join("\n"));
    },
  });
  assert.deepEqual(drawn, ["Санитария", "√ 01.26"]);
});

test("Word-шаблоны — Times New Roman по умолчанию для всего документа", async () => {
  assert.equal(DOCX_FONT, "Times New Roman");
  const { buffer } = await renderJournalDocumentDocx(buildJournalSampleInput("cold_equipment_control"), "cold_equipment_control");
  const zip = await JSZip.loadAsync(buffer);
  const styles = await zip.files["word/styles.xml"].async("string");
  const defaults = /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(styles)?.[0] ?? "";
  assert.match(defaults, /<w:rFonts[^>]*w:ascii="Times New Roman"/);
  assert.match(defaults, /<w:rFonts[^>]*w:hAnsi="Times New Roman"/);
  // Ни одного другого шрифта, прописанного в тексте документа.
  const document = await zip.files["word/document.xml"].async("string");
  const other = [...document.matchAll(/w:(?:ascii|hAnsi)="([^"]+)"/g)].map((m) => m[1]).filter((name) => name !== DOCX_FONT);
  assert.deepEqual(other, []);
});

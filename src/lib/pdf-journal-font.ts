import fs from "fs";
import path from "path";
import type { jsPDF } from "jspdf";

/**
 * Шрифт печатных журналов: «JournalUnicode» — шрифт с засечками в духе
 * Times New Roman, с НАСТОЯЩИМ жирным начертанием.
 *
 * 2026-09-28 (владелец: «шрифт я бы сменил, слишком номинально выглядит;
 * Times New Roman был бы изящнее»): вместо DejaVu Sans — Liberation Serif
 * 2.1.5 (Regular и Bold). Он метрически совместим с Times New Roman (та же
 * ширина букв — строки и таблицы ложатся как в Word) и полностью покрывает
 * кириллицу. Сам Times New Roman класть в репозиторий и на сервер нельзя —
 * лицензия Microsoft/Monotype запрещает распространять файл шрифта; у
 * Liberation Serif — SIL OFL 1.1 (`pdf-fonts/LICENSE-LiberationSerif.txt`),
 * файлы — без изменений из официального релиза
 * (github.com/liberationfonts/liberation-fonts, 2.1.5).
 *
 * Имя семейства прежнее («JournalUnicode»): его знают все отрисовщики
 * бланков. Метрики шрифта для вёрстки — `pdf-journal-sheet.ts`.
 * «Отсканировать» в полосе фирменного QR рисуется своим DejaVu Sans Bold
 * (`brand-qr.ts`) — плитка QR одинакова во всех выходах.
 *
 * Знаков, которых нет в Liberation Serif (✓, ✗, ₽…), jsPDF не нарисует —
 * отрисовщики заменяют их близкими (`journalPrintableText`).
 * Системные пути — запасные для окружений без файлов репозитория.
 */
export const JOURNAL_FONT_NAME = "JournalUnicode";

const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf-fonts");

const REGULAR_CANDIDATES = [
  path.join(FONT_DIR, "LiberationSerif-Regular.ttf"),
  "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
  // Запасные без засечек — только если файлов репозитория нет вовсе.
  path.join(FONT_DIR, "DejaVuSans.ttf"),
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "C:\\Windows\\Fonts\\arial.ttf",
];

/** Жирный файл подбирается к обычному: одно семейство, одинаковые метрики. */
const BOLD_FOR_REGULAR: Record<string, string[]> = {
  "LiberationSerif-Regular.ttf": [
    path.join(FONT_DIR, "LiberationSerif-Bold.ttf"),
    "/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
  ],
  "DejaVuSans.ttf": [
    path.join(FONT_DIR, "DejaVuSans-Bold.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ],
  "arial.ttf": ["C:\\Windows\\Fonts\\arialbd.ttf"],
};

const fileCache = new Map<string, string>();

function readBase64(filePath: string): string {
  const cached = fileCache.get(filePath);
  if (cached) return cached;
  const base64 = fs.readFileSync(filePath).toString("base64");
  fileCache.set(filePath, base64);
  return base64;
}

/** Какой файл реально стоит за жирным начертанием (для проверок). */
export type JournalFontFiles = { regular: string | null; bold: string | null };

export function resolveJournalFontFiles(): JournalFontFiles {
  const regular = REGULAR_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
  if (!regular) return { regular: null, bold: null };
  const boldCandidates = BOLD_FOR_REGULAR[path.basename(regular)] ?? [];
  const bold = boldCandidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  return { regular, bold };
}

/**
 * Регистрирует «JournalUnicode» (normal / bold / italic) в документе.
 * Повторный вызов на том же документе ничего не делает. Возвращает имя
 * шрифта; без единого файла — «helvetica» (кириллицы в ней нет).
 */
export function registerJournalUnicodeFont(doc: jsPDF): string {
  const fontList = doc.getFontList?.() ?? {};
  if (Object.prototype.hasOwnProperty.call(fontList, JOURNAL_FONT_NAME)) {
    return JOURNAL_FONT_NAME;
  }
  const files = resolveJournalFontFiles();
  if (!files.regular) return "helvetica";

  doc.addFileToVFS("journal-unicode.ttf", readBase64(files.regular));
  doc.addFont("journal-unicode.ttf", JOURNAL_FONT_NAME, "normal");
  // Курсив в бланках почти не используется — обычное начертание.
  doc.addFont("journal-unicode.ttf", JOURNAL_FONT_NAME, "italic");
  if (files.bold) {
    doc.addFileToVFS("journal-unicode-bold.ttf", readBase64(files.bold));
    doc.addFont("journal-unicode-bold.ttf", JOURNAL_FONT_NAME, "bold");
    doc.addFont("journal-unicode-bold.ttf", JOURNAL_FONT_NAME, "bolditalic");
  } else {
    doc.addFont("journal-unicode.ttf", JOURNAL_FONT_NAME, "bold");
    doc.addFont("journal-unicode.ttf", JOURNAL_FONT_NAME, "bolditalic");
  }
  return JOURNAL_FONT_NAME;
}

/**
 * Знаки, которых нет в Liberation Serif, → близкие из него. jsPDF рисует
 * отсутствующий знак пустым местом (DejaVu Sans их знал): «✓ 12-03-2026» в
 * плане обучения печаталось бы « 12-03-2026».
 */
const JOURNAL_GLYPH_SUBSTITUTES: Record<string, string> = {
  "✓": "√",
  "✔": "√",
  "✗": "×",
  "✘": "×",
  "₽": "руб.",
  "⇒": "→",
  "★": "*",
  "☆": "*",
  "⌀": "Ø",
};
const MISSING_GLYPHS = new RegExp(`[${Object.keys(JOURNAL_GLYPH_SUBSTITUTES).join("")}]`, "gu");

/** Текст для печати шрифтом журнала: отсутствующие в нём знаки заменены близкими. */
export function journalPrintableText(text: string): string {
  return text.replace(MISSING_GLYPHS, (glyph) => JOURNAL_GLYPH_SUBSTITUTES[glyph] ?? glyph);
}

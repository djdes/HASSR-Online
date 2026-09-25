import fs from "fs";
import path from "path";
import type { jsPDF } from "jspdf";

/**
 * Шрифт печатных журналов: «JournalUnicode» с НАСТОЯЩИМ жирным начертанием.
 *
 * Раньше «bold» и «italic» регистрировались тем же файлом, что и обычное
 * начертание, — `setFont(…, "bold")` ничего не делал, и название журнала,
 * подписи шапки и заголовки столбцов печатались тонким шрифтом.
 *
 * Обычное начертание — полный DejaVu Sans (кириллица, знаки). Жирное —
 * DejaVu Sans Bold той же версии 2.37, урезанный до латиницы, кириллицы,
 * пунктуации и ходовых знаков (°, №, ₽, стрелки, ✓): так он весит ~190 КБ,
 * а PDF растёт на десятки килобайт, а не на полмегабайта. Лицензия —
 * `pdf-fonts/LICENSE-DejaVu.txt` (Bitstream Vera, общая для семейства).
 * Системные пути — запасные для окружений без файлов репозитория.
 */
export const JOURNAL_FONT_NAME = "JournalUnicode";

const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf-fonts");

const REGULAR_CANDIDATES = [
  path.join(FONT_DIR, "DejaVuSans.ttf"),
  "C:\\Windows\\Fonts\\arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
];

/** Жирный файл подбирается к обычному: одно семейство, одинаковые метрики. */
const BOLD_FOR_REGULAR: Record<string, string[]> = {
  "DejaVuSans.ttf": [
    path.join(FONT_DIR, "DejaVuSans-Bold.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ],
  "arial.ttf": ["C:\\Windows\\Fonts\\arialbd.ttf"],
  "LiberationSans-Regular.ttf": ["/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"],
  "Arial.ttf": ["/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf"],
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

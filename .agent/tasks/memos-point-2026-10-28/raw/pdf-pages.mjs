// Текст каждой страницы PDF (первые символы) — какая памятка на каком листе.
// Запуск: node .agent/tasks/memos-point-2026-10-28/raw/pdf-pages.mjs <file.pdf>
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const data = new Uint8Array(readFileSync(process.argv[2]));
const pdf = await getDocument({ data, useSystemFonts: true }).promise;
for (let n = 1; n <= pdf.numPages; n += 1) {
  const page = await pdf.getPage(n);
  const text = (await page.getTextContent()).items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim();
  console.log(`${String(n).padStart(2)}: ${text.slice(0, 150)}`);
}

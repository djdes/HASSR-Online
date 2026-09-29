import fs from "node:fs";
import path from "node:path";

import type { jsPDF } from "jspdf";

/**
 * Шрифт КП — Manrope, шрифт сайта (`src/app/fonts/manrope-variable.ttf`).
 * jsPDF не умеет вариативные шрифты, поэтому в `src/lib/pdf-fonts` лежат
 * статические начертания из того же файла (fontTools instancer, OFL —
 * `LICENSE-Manrope.txt`): Regular 400, SemiBold 600, ExtraBold 800.
 * Кириллица, «₽», «№», «—», ««»» и неразрывный пробел в нём есть.
 *
 * Нет файлов (чужое окружение) — запасной DejaVu Sans из того же каталога:
 * КП напечатается, просто не фирменным шрифтом.
 */

export type ProposalWeight = "regular" | "semibold" | "extrabold";

export type ProposalFonts = {
  /** Имя семейства для каждого начертания и стиль jsPDF. */
  face: Record<ProposalWeight, { family: string; style: "normal" | "bold" }>;
  /** Фирменный ли шрифт (для логов и тестов). */
  brand: boolean;
};

const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf-fonts");

const FILES: Record<ProposalWeight, string> = {
  regular: "Manrope-Regular.ttf",
  semibold: "Manrope-SemiBold.ttf",
  extrabold: "Manrope-ExtraBold.ttf",
};

const FALLBACK: Record<ProposalWeight, string> = {
  regular: "DejaVuSans.ttf",
  semibold: "DejaVuSans-Bold.ttf",
  extrabold: "DejaVuSans-Bold.ttf",
};

const cache = new Map<string, string>();

function base64(file: string): string | null {
  const full = path.join(FONT_DIR, file);
  const hit = cache.get(full);
  if (hit) return hit;
  if (!fs.existsSync(full)) return null;
  const value = fs.readFileSync(full).toString("base64");
  cache.set(full, value);
  return value;
}

/** Регистрирует начертания в документе. Повторный вызов на том же документе безопасен. */
export function registerProposalFonts(doc: jsPDF): ProposalFonts {
  const brand = (Object.keys(FILES) as ProposalWeight[]).every((weight) => base64(FILES[weight]) !== null);
  const files = brand ? FILES : FALLBACK;
  const prefix = brand ? "KpManrope" : "KpDejaVu";
  const face = {} as ProposalFonts["face"];
  for (const weight of Object.keys(files) as ProposalWeight[]) {
    const family = `${prefix}-${weight}`;
    const data = base64(files[weight]);
    if (!data) {
      face[weight] = { family: "helvetica", style: weight === "regular" ? "normal" : "bold" };
      continue;
    }
    const known = doc.getFontList?.() ?? {};
    if (!Object.prototype.hasOwnProperty.call(known, family)) {
      const vfsName = `${family}.ttf`;
      doc.addFileToVFS(vfsName, data);
      doc.addFont(vfsName, family, "normal");
    }
    face[weight] = { family, style: "normal" };
  }
  if (!brand) console.warn("[kp] Manrope font files not found — PDF falls back to DejaVu Sans");
  return { face, brand };
}

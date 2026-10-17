/**
 * Логотип организации в PDF-документах (журналы, ППК, приказы, сводка
 * проверяющего) — 2026-10-17.
 *
 * Логотип хранится файлом `OrganizationLogo` (PNG или очищенный SVG, см.
 * `org-logo-file.ts`). jsPDF умеет PNG, но не SVG — SVG растеризуется здесь
 * же в PNG (`@napi-rs/canvas`, подгружается лениво: модуль зовут и чистые
 * рендеры на образцах). Внешняя ссылка (`logoUrl` = http/https) в PDF не
 * попадает: сервер не скачивает чужие адреса (SSRF) — такой логотип виден
 * только в HTML-листах как `<img>`.
 */

import fs from "node:fs";
import path from "node:path";

import type { jsPDF } from "jspdf";

import { ORG_LOGO_PATH_PATTERN } from "@/lib/org-logo-file";
import { readPngSize } from "@/lib/partners/validation";

/**
 * `logoUrl` — адрес загруженного файла именно этой организации
 * (`/api/org-assets/<organizationId>/logo?v=…`). Внешняя ссылка или адрес
 * чужого файла — не логотип для PDF: сервер их не читает.
 */
export function isOwnUploadedLogo(organizationId: string, logoUrl: string | null | undefined): boolean {
  if (!logoUrl || !ORG_LOGO_PATH_PATTERN.test(logoUrl)) return false;
  return logoUrl.startsWith(`/api/org-assets/${organizationId}/logo`);
}

/** PNG логотипа для `addImage` и его размер в пикселях (для пропорций). */
export type PdfLogo = {
  data: Uint8Array;
  width: number;
  height: number;
};

/** Высота растра SVG, px: с запасом на печать логотипа высотой до 20 мм. */
const SVG_RASTER_HEIGHT = 320;
/** Предел ширины растра: вытянутые SVG-логотипы не раздувают PDF. */
const SVG_RASTER_MAX_WIDTH = 1600;

/** Шрифты для текста внутри SVG-логотипа: с кириллицей, одинаковые на Windows и на сервере. */
export const SVG_LOGO_SANS = "WeSetup Logo Sans";
export const SVG_LOGO_SERIF = "WeSetup Logo Serif";
const SVG_FONT_FILES: Array<[string, string]> = [
  ["DejaVuSans.ttf", SVG_LOGO_SANS],
  ["DejaVuSans-Bold.ttf", SVG_LOGO_SANS],
  ["LiberationSerif-Regular.ttf", SVG_LOGO_SERIF],
  ["LiberationSerif-Bold.ttf", SVG_LOGO_SERIF],
];
const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
]);

/**
 * Семейства шрифтов в SVG → одно доступное растеризатору. `@napi-rs/canvas`
 * берёт только первое имя списка, а незнакомое (шрифт не установлен) или
 * общее (`sans-serif`) подменяет шрифтом без кириллицы: «Точки» в логотипе
 * печатались квадратиками. Оставляем первое установленное семейство из
 * списка, иначе — наш шрифт с кириллицей (с засечками, если список просил
 * `serif`). Текст без шрифта получает его от корня `<svg>`.
 */
export function resolveSvgFontFamilies(svg: string, has: (family: string) => boolean): string {
  const pick = (list: string): string => {
    const families = list
      .split(",")
      .map((family) => family.trim().replace(/^['"]+|['"]+$/g, "").trim())
      .filter(Boolean);
    const installed = families.find((family) => !GENERIC_FONT_FAMILIES.has(family.toLowerCase()) && has(family));
    if (installed) return installed;
    return families.some((family) => family.toLowerCase() === "serif") ? SVG_LOGO_SERIF : SVG_LOGO_SANS;
  };
  /** Имя для CSS: с пробелами и прочим — в кавычках, не совпадающих с кавычками атрибута. */
  const cssName = (family: string, quote: string) => (/^[A-Za-z0-9_-]+$/.test(family) ? family : `${quote}${family}${quote}`);
  const fixCss = (css: string, quote: string, stop: RegExp) =>
    css.replace(new RegExp(`font-family\\s*:\\s*(${stop.source})`, "gi"), (_match, value: string) => `font-family: ${cssName(pick(value), quote)}`);

  return (
    svg
      // Атрибут font-family="…" / '…' (внутри — имена в других кавычках).
      .replace(/(\sfont-family\s*=\s*)"([^"]*)"/gi, (_match, prefix: string, value: string) => `${prefix}"${pick(value)}"`)
      .replace(/(\sfont-family\s*=\s*)'([^']*)'/gi, (_match, prefix: string, value: string) => `${prefix}'${pick(value)}'`)
      // style="…" и style='…': значение — до «;» или конца атрибута.
      .replace(/(\sstyle\s*=\s*)"([^"]*)"/gi, (_match, prefix: string, css: string) => `${prefix}"${fixCss(css, "'", /[^;]*/)}"`)
      .replace(/(\sstyle\s*=\s*)'([^']*)'/gi, (_match, prefix: string, css: string) => `${prefix}'${fixCss(css, '"', /[^;]*/)}'`)
      // <style>…</style>: значение — до «;» или «}».
      .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_match, open: string, css: string, close: string) => `${open}${fixCss(css, "'", /[^;}<]*/)}${close}`)
      // Шрифт по умолчанию — на корне (наследуется текстом без своего шрифта).
      .replace(/<svg\b(?![^>]*\sfont-family\s*=)/i, `<svg font-family="${SVG_LOGO_SANS}"`)
  );
}

let svgFontsReady = false;

/** Регистрирует шрифты `SVG_LOGO_*` из репозитория (`src/lib/pdf-fonts`) один раз. */
function ensureSvgLogoFonts(globalFonts: { registerFromPath: (file: string, family: string) => unknown }): void {
  if (svgFontsReady) return;
  svgFontsReady = true;
  const dir = path.join(process.cwd(), "src", "lib", "pdf-fonts");
  for (const [file, family] of SVG_FONT_FILES) {
    const fontPath = path.join(dir, file);
    if (fs.existsSync(fontPath)) globalFonts.registerFromPath(fontPath, family);
  }
}

/**
 * Файл логотипа → PNG для PDF. PNG — как есть, SVG — растр высотой
 * `SVG_RASTER_HEIGHT` с сохранением пропорций. Битый файл → null (документ
 * печатается без логотипа, а не падает).
 */
export async function pdfLogoFromFile(file: { bytes: Uint8Array; mime: string }): Promise<PdfLogo | null> {
  const png = readPngSize(file.bytes);
  if (png && png.width > 0 && png.height > 0) {
    return { data: file.bytes, width: png.width, height: png.height };
  }
  if (file.mime !== "image/svg+xml") return null;
  try {
    const { createCanvas, loadImage, GlobalFonts } = await import("@napi-rs/canvas");
    ensureSvgLogoFonts(GlobalFonts);
    const source = resolveSvgFontFamilies(new TextDecoder("utf-8").decode(file.bytes), (family) => GlobalFonts.has(family));
    const image = await loadImage(Buffer.from(source, "utf8"));
    if (!image.width || !image.height) return null;
    const scale = Math.min(SVG_RASTER_HEIGHT / image.height, SVG_RASTER_MAX_WIDTH / image.width);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    canvas.getContext("2d").drawImage(image, 0, 0, width, height);
    return { data: new Uint8Array(canvas.toBuffer("image/png")), width, height };
  } catch (error) {
    console.warn("[pdf-logo] SVG rasterize failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Размер логотипа в мм внутри коробки `maxW × maxH` с сохранением пропорций. */
export function fitPdfLogo(logo: Pick<PdfLogo, "width" | "height">, maxW: number, maxH: number): { w: number; h: number } {
  const ratio = logo.width / logo.height;
  let h = maxH;
  let w = h * ratio;
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  return { w, h };
}

/**
 * Нарисовать логотип в коробке (`x`, `y` — левый верхний угол коробки).
 * По горизонтали — `align` внутри коробки, по вертикали — сверху.
 * Возвращает фактический размер, мм.
 */
export function drawPdfLogo(
  doc: jsPDF,
  logo: PdfLogo,
  box: { x: number; y: number; maxW: number; maxH: number; align?: "left" | "center" | "right" },
): { w: number; h: number } {
  const { w, h } = fitPdfLogo(logo, box.maxW, box.maxH);
  const x =
    box.align === "center" ? box.x + (box.maxW - w) / 2 : box.align === "right" ? box.x + box.maxW - w : box.x;
  // Один alias на документ: jsPDF кладёт картинку в файл один раз, на
  // остальных страницах — ссылка.
  doc.addImage(logo.data, "PNG", x, box.y, w, h, "org-logo", "FAST");
  return { w, h };
}

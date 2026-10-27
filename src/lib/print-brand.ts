/**
 * Фирменный стиль печати (2026-10-27): плакаты, QR-листы, наклейки, таблички
 * на оборудование и этикетки «Сетап помощника» — одна рамка и одни цвета.
 *
 * - Три цвета, все необязательные: основной (рамка, шапка, рамка QR),
 *   дополнительный (номера шагов, значки), фон (светлые подложки). Не задан
 *   ни один — цвет WeSetup; задан один — остальные подбираются из него.
 * - Шапка везде одинаковая: логотип организации слева, сайт справа
 *   (`website`, пусто — wesetup.ru).
 * - Режим «Ч/б» (`mono`): все цвета чёрные, подложки белые — лист для
 *   ч/б принтера. Цвет нигде не несёт смысла в одиночку.
 * - Журналы и PDF-документы сюда не относятся: они остаются ч/б по
 *   правилу 2026-09-27 (`print-colors.test.ts`).
 *
 * Как рисовать, чтобы цвет дожил до бумаги (печать в кабинете делает весь
 * текст чёрным и фоны прозрачными, `app-theme.css` → `@media print`):
 * - цветные линии и рамки — `border` с явным цветом (не `currentColor`);
 * - цветные заливки и значки — SVG со `style={{ fill, stroke }}` из этих
 *   цветов (не `currentColor`: в печати он чёрный);
 * - цветной фон у HTML-элемента — только с `data-print-keep-bg`.
 *
 * Чистые функции, без БД и DOM. Загрузка из БД — `print-brand.server.ts`.
 */

import {
  DOCUMENT_INK,
  WESETUP_ACCENT,
  brandInk,
  brandOnColor,
  brandTint,
  contrastRatio,
  normalizeBrandColor,
  rgbToHex,
} from "@/lib/document-brand";

/** Сайт в шапке, когда организация свой не указала. */
export const DEFAULT_PRINT_SITE = "wesetup.ru";

/** Поля организации, из которых собирается стиль печати. */
export type PrintBrandSource = {
  name: string;
  logoUrl: string | null;
  qrIconUrl: string | null;
  brandColor: string | null;
  brandColor2: string | null;
  brandColor3: string | null;
  website: string | null;
  qrBrandFrame: boolean;
  qrCenterLogo: boolean;
};

export type PrintColors = {
  /** Основной: рамка листа, линия шапки, рамка QR. */
  primary: string;
  /** Основной для тонких линий и текста на белом (контраст ≥ 3:1). */
  primaryInk: string;
  /** Текст поверх заливки основным цветом. */
  primaryOnFill: string;
  /** Дополнительный: номера шагов, значки, маркеры. */
  secondary: string;
  /** Дополнительный для линий и текста на белом (контраст ≥ 3:1). */
  secondaryInk: string;
  /** Текст поверх заливки дополнительным цветом. */
  secondaryOnFill: string;
  /** Светлая подложка блоков и шапок таблиц. */
  background: string;
  /** Основной текст листа. */
  text: string;
};

export type PrintBrand = {
  orgName: string;
  logoUrl: string | null;
  /** Квадратный значок для центра QR (загруженный файл). */
  qrIconUrl: string | null;
  /** Сайт справа в шапке, без протокола: «wesetup.ru», «dobroe-kafe.ru». */
  site: string;
  colors: PrintColors;
  /** Режим «Ч/б»: все цвета чёрные. */
  mono: boolean;
  /** Организация задала хотя бы один свой цвет (иначе — цвет WeSetup). */
  custom: boolean;
  qr: {
    /** Рамка и полоса «Отсканировать» в основном цвете (в ч/б — чёрные). */
    brandFrame: boolean;
    /** Значок или логотип организации в центре QR. */
    centerLogo: boolean;
  };
};

/** Подложка должна быть светлой: тёмный текст на ней читается не хуже 9:1. */
const BACKGROUND_MIN_TEXT_CONTRAST = 9;

/** Все цвета режима «Ч/б». */
export const MONO_PRINT_COLORS: PrintColors = {
  primary: "#000000",
  primaryInk: "#000000",
  primaryOnFill: "#ffffff",
  secondary: "#000000",
  secondaryInk: "#000000",
  secondaryOnFill: "#ffffff",
  background: "#ffffff",
  text: "#000000",
};

function lightBackground(hex: string): string {
  if (contrastRatio(hex, DOCUMENT_INK) >= BACKGROUND_MIN_TEXT_CONTRAST) return hex;
  // Тёмный «фоновый» цвет осветляем, пока тёмный текст на нём не станет читаемым.
  for (const amount of [0.24, 0.18, 0.14, 0.1, 0.07]) {
    const tint = rgbToHex(brandTint(hex, amount));
    if (contrastRatio(tint, DOCUMENT_INK) >= BACKGROUND_MIN_TEXT_CONTRAST) return tint;
  }
  return "#ffffff";
}

/**
 * Три цвета организации → цвета листа. Пустые подбираются: дополнительный
 * повторяет основной, фон — светлый оттенок основного.
 */
export function resolvePrintColors(
  color1: string | null | undefined,
  color2?: string | null,
  color3?: string | null,
): PrintColors {
  const primary = normalizeBrandColor(color1) ?? WESETUP_ACCENT;
  const secondary = normalizeBrandColor(color2) ?? primary;
  const own3 = normalizeBrandColor(color3);
  const background = own3 ? lightBackground(own3) : rgbToHex(brandTint(primary, 0.1));
  return {
    primary,
    primaryInk: brandInk(primary),
    primaryOnFill: brandOnColor(primary),
    secondary,
    secondaryInk: brandInk(secondary),
    secondaryOnFill: brandOnColor(secondary),
    background,
    text: DOCUMENT_INK,
  };
}

/**
 * Сайт для шапки: без протокола, «www.» и хвостового «/». Пробелы, пустое,
 * строка без точки или длиннее 80 символов → null.
 */
export function normalizeWebsite(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  value = value.replace(/\/+$/, "");
  if (!value || value.length > 80 || /\s/.test(value) || !value.includes(".")) return null;
  const slash = value.indexOf("/");
  const host = slash === -1 ? value : value.slice(0, slash);
  if (!/^[\p{L}\p{N}.-]+$/u.test(host) || host.startsWith(".") || host.endsWith(".")) return null;
  return host.toLowerCase() + (slash === -1 ? "" : value.slice(slash));
}

export function resolvePrintBrand(
  source: PrintBrandSource,
  options: { mono?: boolean } = {},
): PrintBrand {
  const mono = options.mono === true;
  const custom = [source.brandColor, source.brandColor2, source.brandColor3].some(
    (value) => normalizeBrandColor(value) !== null,
  );
  return {
    orgName: source.name.trim(),
    logoUrl: source.logoUrl?.trim() || null,
    qrIconUrl: source.qrIconUrl?.trim() || null,
    site: normalizeWebsite(source.website) ?? DEFAULT_PRINT_SITE,
    colors: mono
      ? MONO_PRINT_COLORS
      : resolvePrintColors(source.brandColor, source.brandColor2, source.brandColor3),
    mono,
    custom,
    qr: { brandFrame: source.qrBrandFrame, centerLogo: source.qrCenterLogo },
  };
}

/** Стиль WeSetup без организации (образцы, предпросмотр по умолчанию). */
export const DEFAULT_PRINT_BRAND_SOURCE: PrintBrandSource = {
  name: "",
  logoUrl: null,
  qrIconUrl: null,
  brandColor: null,
  brandColor2: null,
  brandColor3: null,
  website: null,
  qrBrandFrame: true,
  qrCenterLogo: true,
};

/** `?bw=1` (или `true`, `yes`) — режим «Ч/б». */
export function isMonoParam(value: string | string[] | null | undefined): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && /^(1|true|yes)$/i.test(raw.trim());
}

/**
 * CSS-переменные листа: `style={printBrandCssVars(brand.colors)}` на корне
 * плаката или листа, внутри — `var(--pb-primary)` и т. д.
 */
export function printBrandCssVars(colors: PrintColors): Record<string, string> {
  return {
    "--pb-primary": colors.primary,
    "--pb-primary-ink": colors.primaryInk,
    "--pb-on-primary": colors.primaryOnFill,
    "--pb-secondary": colors.secondary,
    "--pb-secondary-ink": colors.secondaryInk,
    "--pb-on-secondary": colors.secondaryOnFill,
    "--pb-bg": colors.background,
    "--pb-text": colors.text,
  };
}

/**
 * Цвет рамки и полосы «Отсканировать» у QR. Белая надпись на полосе должна
 * читаться (≥ 4,5:1), поэтому светлый фирменный цвет затемняется. Рамка
 * выключена или режим «Ч/б» — чёрный. Сами модули кода всегда чёрные.
 */
export function qrFrameColor(brand: Pick<PrintBrand, "colors" | "mono" | "qr">): string {
  if (brand.mono || !brand.qr.brandFrame) return "#000000";
  return brandInk(brand.colors.primary, 4.5);
}

const LEGAL_FORMS = /^(ооо|оао|зао|пао|ао|ип|мау|мбу|мбоу|мбдоу|гбу|гбоу|фгуп|муп|гуп|нко|ано|чоу|llc|ltd|inc)\.?\s+/i;

/**
 * Буква для центра QR, когда квадратного значка нет: первая буква названия
 * без организационно-правовой формы и кавычек. «ООО «Доброе кафе»» → «Д».
 */
export function orgMonogram(name: string): string {
  let value = name.trim();
  for (let i = 0; i < 3; i += 1) {
    const next = value.replace(LEGAL_FORMS, "").replace(/^[\s"'«»„“”(]+/, "");
    if (next === value) break;
    value = next;
  }
  const letter = value.match(/[\p{L}\p{N}]/u)?.[0];
  return letter ? letter.toLocaleUpperCase("ru-RU") : "W";
}

/** Логотип годится в центр QR, если он почти квадратный (стороны до 1 : 1,25). */
export function isSquareishLogo(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  const ratio = width > height ? width / height : height / width;
  return ratio <= 1.25;
}

/**
 * Размеры логотипа организации на печати (мм) — увеличены вдвое 2026-10-27:
 * A4 12 → 24, A5 10 → 20, наклейка 2,6 → 5,2.
 */
export const PRINT_LOGO_MM = {
  a4: { height: 24, maxWidth: 110 },
  a5: { height: 20, maxWidth: 90 },
  plate: { height: 14, maxWidth: 60 },
  sticker: { height: 5.2, maxWidth: 24 },
} as const;

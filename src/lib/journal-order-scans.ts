/**
 * Сканы приказов к журналу (2026-09-24, пожелание РПН): приказ о
 * назначении ответственного за гигиенический журнал, о бракеражной
 * комиссии и т. п. Привязка — организация + код журнала; приказ идёт со
 * всеми документами журнала: на странице документа, у проверяющего и в
 * печати после страниц журнала.
 *
 * Модуль без БД и без pdf-lib (его импортирует и клиент): список
 * журналов, лимиты, тип файла, название. Проверка PDF и склейка печати —
 * `journal-order-scans-pdf.ts`.
 */

export const ORDER_SCAN_JOURNALS: Readonly<Record<string, { example: string }>> = {
  hygiene: { example: "приказ о назначении ответственного за гигиенический журнал" },
  finished_product: { example: "приказ о создании бракеражной комиссии" },
};

export function supportsOrderScans(journalCode: string | null | undefined): boolean {
  return typeof journalCode === "string" && Object.prototype.hasOwnProperty.call(ORDER_SCAN_JOURNALS, journalCode);
}

export const ORDER_SCAN_MAX_BYTES = 10 * 1024 * 1024;
export const ORDER_SCAN_MAX_FILES = 10;
export const ORDER_SCAN_TITLE_MAX = 200;

export type OrderScanMime = "application/pdf" | "image/jpeg" | "image/png";

export const ORDER_SCAN_ERRORS = {
  empty: "Файл пустой — выберите скан приказа",
  tooBig: "Файл больше 10 МБ — сожмите скан или сохраните в меньшем разрешении",
  tooMany: `К журналу можно приложить не больше ${ORDER_SCAN_MAX_FILES} файлов — удалите ненужный приказ`,
  heic: "Формат HEIC не поддерживается — сохраните фото как JPG (iPhone: Настройки → Камера → Форматы → «Наиболее совместимый») или отправьте PDF",
  type: "Подойдут PDF, JPG или PNG",
  pdf: "PDF не открывается: файл повреждён или защищён паролем — сохраните его без пароля",
  image: "Картинка не открывается — сохраните скан заново как JPG или PNG",
  dimensions: "Слишком большая картинка по числу точек — сохраните скан в меньшем разрешении (до 40 мегапикселей)",
  unreadable: "Не удалось прочитать файл — сохраните его заново или сфотографируйте документ",
  title: "Введите название приказа",
} as const;

/**
 * Пределы картинки до декодирования: 0,4 МБ PNG из нулей 20000×20000 при
 * встраивании разжимается в гигабайты. Сторона и число точек читаются из
 * заголовка (IHDR / SOF) — до любой распаковки.
 */
export const ORDER_SCAN_MAX_IMAGE_SIDE = 12_000;
export const ORDER_SCAN_MAX_IMAGE_PIXELS = 40_000_000;

/** Ширина и высота из заголовка PNG (IHDR) или JPEG (SOF); не нашли — null. */
export function orderScanImageSize(bytes: Uint8Array, mime: "image/jpeg" | "image/png"): { width: number; height: number } | null {
  const u16 = (at: number) => (bytes[at] << 8) | bytes[at + 1];
  if (mime === "image/png") {
    // Сигнатура (8) + длина чанка (4) + «IHDR» (4) + ширина (4) + высота (4).
    if (bytes.length < 24 || ascii(bytes, 12, 16) !== "IHDR") return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1; // заполнитель
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2; // маркеры без длины
      continue;
    }
    // SOF0–SOF15, кроме DHT (C4), JPG (C8) и DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 8 >= bytes.length) return null;
      const height = u16(at + 5);
      const width = u16(at + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // конец или данные — а размера так и не было
    at += 2 + u16(at + 2);
  }
  return null;
}

/** Картинка в пределах сторон и мегапикселей. */
export function orderScanImageWithinLimits(size: { width: number; height: number }): boolean {
  return (
    size.width <= ORDER_SCAN_MAX_IMAGE_SIDE &&
    size.height <= ORDER_SCAN_MAX_IMAGE_SIDE &&
    size.width * size.height <= ORDER_SCAN_MAX_IMAGE_PIXELS
  );
}

/** «%PDF-» должен начаться в первых 16 байтах. */
const PDF_HEADER_WINDOW = 16;

function pdfPrefixAllowed(prefix: Uint8Array): boolean {
  let start = 0;
  if (prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf) start = 3; // UTF-8 BOM
  for (let i = start; i < prefix.length; i += 1) {
    const b = prefix[i];
    if (b !== 0x00 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x20) return false;
  }
  return true;
}

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)));
}

/** Тип файла — по содержимому (не по имени и не по заявленному mime). */
export function sniffOrderScanType(bytes: Uint8Array, fileName = "", declaredMime = ""): { ok: true; mime: OrderScanMime } | { ok: false; error: string } {
  if (bytes.length === 0) return { ok: false, error: ORDER_SCAN_ERRORS.empty };
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(bytes, 8, 12))) {
    return { ok: false, error: ORDER_SCAN_ERRORS.heic };
  }
  if (/\.hei[cf]$/i.test(fileName) || /^image\/hei[cf]/i.test(declaredMime)) return { ok: false, error: ORDER_SCAN_ERRORS.heic };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ok: true, mime: "image/jpeg" };
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) {
    return { ok: true, mime: "image/png" };
  }
  // «%PDF-» — в самом начале; перед ним допустимы только BOM, пробелы и
  // нули (так пишут некоторые сканеры). HTML или скрипт перед PDF — отказ:
  // такой «полиглот» браузер мог бы прочитать как страницу.
  const head = bytes.subarray(0, Math.min(bytes.length, PDF_HEADER_WINDOW + 5));
  const at = ascii(head, 0, head.length).indexOf("%PDF-");
  if (at >= 0 && at <= PDF_HEADER_WINDOW && pdfPrefixAllowed(head.subarray(0, at))) return { ok: true, mime: "application/pdf" };
  return { ok: false, error: ORDER_SCAN_ERRORS.type };
}

/** Название по умолчанию — имя файла без расширения. */
export function defaultOrderScanTitle(fileName: string): string {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_\s]+/g, " ").trim();
  return (base || "Приказ").slice(0, ORDER_SCAN_TITLE_MAX);
}

/** Название от пользователя: обрезка пробелов, не пустое, до 200 символов. */
export function normalizeOrderScanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/\s+/g, " ").trim().slice(0, ORDER_SCAN_TITLE_MAX);
  return title.length > 0 ? title : null;
}

/**
 * Можно ли отдать файл скана: только своей организации (сессия или токен
 * проверяющего), журнал с приказами, журнал доступен смотрящему и не
 * отключён. Иначе маршрут отвечает 404 — не подсказывая, что файл есть.
 */
export function orderScanAccessible(input: {
  scan: { organizationId: string; journalCode: string } | null;
  /** Организация сессии или токена; null — ни того, ни другого. */
  organizationId: string | null;
  journalReadable: boolean;
  disabledCodes?: ReadonlySet<string>;
}): boolean {
  const { scan } = input;
  if (!scan || !input.organizationId) return false;
  if (scan.organizationId !== input.organizationId) return false;
  if (!supportsOrderScans(scan.journalCode)) return false;
  if (input.disabledCodes?.has(scan.journalCode)) return false;
  return input.journalReadable;
}

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
  title: "Введите название приказа",
} as const;

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
  // «%PDF-» — в первых байтах (иногда после мусорного префикса сканера).
  if (ascii(bytes, 0, 1024).includes("%PDF-")) return { ok: true, mime: "application/pdf" };
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

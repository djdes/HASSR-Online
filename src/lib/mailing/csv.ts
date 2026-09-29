import { checkEmail } from "@/lib/email-validation";
import { LEGACY_SPHERE_MAP, ORG_SPHERES, type OrgSphere } from "@/lib/org-profile";

/**
 * Разбор загруженных контактов: CSV-файл (UTF-8 или Windows-1251 —
 * выгрузки из Excel и 1С часто в ней) или текст, вставленный в поле.
 *
 * Разделитель — `;`, `,` или табуляция (копия из Excel), определяется по
 * первым строкам вне кавычек. Кавычки по RFC 4180 (`""` внутри поля,
 * перевод строки внутри кавычек). Первая строка — заголовок, если в ней
 * нет почты и узнаётся хотя бы одно название колонки; иначе колонку почты
 * находим по содержимому.
 *
 * Чистый модуль: сервер повторяет разбор при сохранении, поэтому то, что
 * ROOT увидел в предпросмотре, и то, что запишется, считает одна функция.
 */

export const CONTACT_FIELDS = ["email", "name", "company", "sphere", "city", "phone", "tags"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];
export type ColumnMapping = Array<ContactField | "skip">;

export const CONTACT_FIELD_LABELS: Record<ContactField | "skip", string> = {
  email: "Почта",
  name: "Имя",
  company: "Компания",
  sphere: "Сфера",
  city: "Город",
  phone: "Телефон",
  tags: "Теги",
  skip: "Не загружать",
};

export const MAX_IMPORT_ROWS = 20_000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type CsvEncoding = "utf-8" | "windows-1251" | "text";
export type CsvDelimiter = ";" | "," | "\t";

/** Байты файла → текст. Невалидный UTF-8 — значит Windows-1251. */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  let body = bytes;
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) {
    body = body.subarray(3);
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1251").decode(body), encoding: "windows-1251" };
  }
}

function countOutsideQuotes(line: string, ch: string): number {
  let inQuotes = false;
  let count = 0;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ch && !inQuotes) count += 1;
  }
  return count;
}

/** `;` / `,` / таб — чего больше в первых строках; null — одна колонка. */
export function detectDelimiter(text: string): CsvDelimiter | null {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 5);
  let best: CsvDelimiter | null = null;
  let bestScore = 0;
  for (const d of [";", "\t", ","] as const) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const min = counts.length ? Math.min(...counts) : 0;
    // Стабильно во всех строках — сильнее, чем много в одной.
    const score = min > 0 ? min * 10 + counts.reduce((a, b) => a + b, 0) : 0;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** CSV → строки ячеек (кавычки, `""`, переводы строк в кавычках). */
export function parseCsvRows(text: string, delimiter: CsvDelimiter | null): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"' && cell.trim() === "") {
      cell = "";
      inQuotes = true;
    } else if (delimiter && c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows
    .map((r) => r.map((v) => v.trim()))
    .filter((r) => r.some((v) => v !== ""));
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();
}

/** Название колонки → поле контакта. */
export function guessField(header: string): ContactField | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  if (/mail|эл почт|электронн|^почта$|емейл|имейл|мейл/.test(h)) return "email";
  if (/телефон|^тел\b|phone|^моб/.test(h)) return "phone";
  if (/(^|\s)тег|метк|^tags?$/.test(h)) return "tags";
  if (/сфер|^тип|категор|рубрик|sphere|вид деятельности|формат/.test(h)) return "sphere";
  if (/город|city|населен/.test(h)) return "city";
  if (/компан|организац|назван|заведен|company|бренд|юрлиц/.test(h)) return "company";
  if (/имя|фио|^name$|контакт|представител|руководител/.test(h)) return "name";
  return null;
}

/** Ячейка почты: `mailto:`, `<…>`, «Иван <ivan@mail.ru>». */
export function normalizeEmailCell(raw: string): { email: string; name: string | null } {
  let value = raw.trim();
  let name: string | null = null;
  const angle = value.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (angle) {
    name = angle[1].replace(/^["'\s]+|["'\s]+$/g, "") || null;
    value = angle[2];
  }
  value = value.replace(/^mailto:/i, "").trim().toLowerCase();
  return { email: value, name };
}

const SPHERE_SYNONYMS: Record<string, OrgSphere> = {
  ресторан: "restaurant",
  рестораны: "restaurant",
  кафе: "cafe",
  кофейня: "cafe",
  кофейни: "cafe",
  бар: "bar",
  паб: "bar",
  столовая: "canteen",
  столовые: "canteen",
  фастфуд: "fastfood",
  "фаст фуд": "fastfood",
  пекарня: "bakery",
  пекарни: "bakery",
  кондитерская: "bakery",
  кейтеринг: "catering",
  доставка: "catering",
  отель: "hotel",
  гостиница: "hotel",
  магазин: "retail",
  азс: "gas_station",
  школа: "education",
  детсад: "education",
  "детский сад": "education",
  лагерь: "education",
  больница: "medical",
  медцентр: "medical",
  санаторий: "medical",
  производство: "production",
  фитнес: "fitness",
  бассейн: "fitness",
  "салон красоты": "beauty",
  барбершоп: "beauty",
  маникюр: "beauty",
};

const SPHERE_CODES = new Set<string>(ORG_SPHERES.map((s) => s.value));

/** Сфера по коду («cafe») или названию («Кафе / Кофейня», «кофейня»). */
export function resolveSphere(raw: string | null | undefined): OrgSphere | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const lower = value.toLowerCase().replace(/ё/g, "е");
  if (SPHERE_CODES.has(lower)) return lower as OrgSphere;
  if (LEGACY_SPHERE_MAP[lower]) return LEGACY_SPHERE_MAP[lower];
  for (const s of ORG_SPHERES) {
    if (s.label.toLowerCase().replace(/ё/g, "е") === lower) return s.value;
  }
  const words = normalizeHeader(value);
  if (SPHERE_SYNONYMS[words]) return SPHERE_SYNONYMS[words];
  for (const s of ORG_SPHERES) {
    const parts = s.label
      .toLowerCase()
      .replace(/ё/g, "е")
      .split("/")
      .map((p) => normalizeHeader(p));
    if (parts.includes(words)) return s.value;
  }
  return null;
}

export function parseTags(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").split(/[,;|]+/)) {
    const tag = part.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

export type ImportRowStatus = "ok" | "invalid" | "duplicate";

export type ImportRow = {
  /** Номер строки в файле (с 1, считая заголовок). */
  line: number;
  email: string;
  name: string | null;
  company: string | null;
  sphere: OrgSphere | null;
  /** Как сфера записана в файле — чтобы показать нераспознанную. */
  sphereRaw: string | null;
  city: string | null;
  phone: string | null;
  tags: string[];
  status: ImportRowStatus;
  error?: string;
  warning?: string;
};

export type ParsedContacts = {
  encoding: CsvEncoding;
  delimiter: CsvDelimiter | null;
  hasHeader: boolean;
  /** Заголовки колонок (или «Колонка N»). */
  headers: string[];
  /** Примеры значений по колонкам — для сопоставления. */
  samples: string[][];
  mapping: ColumnMapping;
  rows: ImportRow[];
  truncated: boolean;
  summary: { total: number; ok: number; invalid: number; duplicates: number; warnings: number };
};

const EMAILISH = /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/;
const BARE_EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function autoMapping(headerRow: string[] | null, rows: string[][], columns: number): ColumnMapping {
  const mapping: ColumnMapping = Array.from({ length: columns }, () => "skip");
  const used = new Set<ContactField>();
  if (headerRow) {
    headerRow.forEach((h, i) => {
      const field = guessField(h);
      if (field && !used.has(field)) {
        mapping[i] = field;
        used.add(field);
      }
    });
  }
  if (!used.has("email")) {
    // Колонка, где больше всего адресов.
    let bestIndex = -1;
    let bestCount = 0;
    for (let i = 0; i < columns; i += 1) {
      const count = rows.slice(0, 50).filter((r) => EMAILISH.test(r[i] ?? "")).length;
      if (count > bestCount) {
        bestCount = count;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) {
      mapping[bestIndex] = "email";
      used.add("email");
    }
  }
  return mapping;
}

function isHeaderRow(row: string[]): boolean {
  if (row.some((c) => EMAILISH.test(c))) return false;
  return row.some((c) => guessField(c) !== null);
}

/**
 * Разобрать контакты. `mapping` — ручное сопоставление колонок из
 * предпросмотра; без него — автоматическое.
 */
export function parseContacts(
  input: { text: string; encoding?: CsvEncoding },
  options: { mapping?: ColumnMapping | null; maxRows?: number } = {}
): ParsedContacts {
  const encoding = input.encoding ?? "text";
  const delimiter = detectDelimiter(input.text);
  let allRows = parseCsvRows(input.text, delimiter);
  const hasHeader = allRows.length > 0 && isHeaderRow(allRows[0]);
  // Вставили просто адреса через запятую или точку с запятой — это
  // список, а не таблица: каждая почта — своя строка.
  const parts = (cell: string) =>
    cell
      .split(/[,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);
  if (
    !hasHeader &&
    allRows.length > 0 &&
    allRows.every((r) => r.every((c) => parts(c).every((p) => BARE_EMAIL.test(p))))
  ) {
    allRows = allRows.flat().flatMap(parts).map((c) => [c]);
  }
  const columns = Math.max(1, ...allRows.map((r) => r.length));
  const headerRow = hasHeader ? allRows[0] : null;
  const dataRows = hasHeader ? allRows.slice(1) : allRows;
  const maxRows = options.maxRows ?? MAX_IMPORT_ROWS;
  const truncated = dataRows.length > maxRows;
  const body = truncated ? dataRows.slice(0, maxRows) : dataRows;

  const auto = autoMapping(headerRow, body, columns);
  const mapping: ColumnMapping =
    options.mapping && options.mapping.length === columns ? options.mapping : auto;
  const headers = Array.from({ length: columns }, (_, i) => headerRow?.[i]?.trim() || `Колонка ${i + 1}`);
  const samples = Array.from({ length: columns }, (_, i) =>
    body
      .map((r) => r[i] ?? "")
      .filter(Boolean)
      .slice(0, 3)
  );

  const col = (field: ContactField) => mapping.indexOf(field);
  const idx = {
    email: col("email"),
    name: col("name"),
    company: col("company"),
    sphere: col("sphere"),
    city: col("city"),
    phone: col("phone"),
    tags: col("tags"),
  };
  const cellAt = (row: string[], i: number): string | null => {
    if (i < 0) return null;
    const v = (row[i] ?? "").trim();
    return v ? v.slice(0, 200) : null;
  };

  const seen = new Set<string>();
  const rows: ImportRow[] = body.map((row, n) => {
    const line = n + 1 + (hasHeader ? 1 : 0);
    const rawEmail = cellAt(row, idx.email) ?? "";
    const { email, name: nameFromEmail } = normalizeEmailCell(rawEmail);
    const sphereRaw = cellAt(row, idx.sphere);
    const sphere = resolveSphere(sphereRaw);
    const draft: ImportRow = {
      line,
      email,
      name: cellAt(row, idx.name) ?? nameFromEmail,
      company: cellAt(row, idx.company),
      sphere,
      sphereRaw,
      city: cellAt(row, idx.city),
      phone: cellAt(row, idx.phone),
      tags: parseTags(cellAt(row, idx.tags)),
      status: "ok",
    };
    if (idx.email < 0) {
      return { ...draft, status: "invalid", error: "Не выбрана колонка с почтой" };
    }
    const check = checkEmail(email);
    if (check.status === "empty" || check.status === "invalid") {
      return { ...draft, status: "invalid", error: email ? check.message : "Пустая почта" };
    }
    if (check.status === "typo" && check.certain) {
      return { ...draft, status: "invalid", error: check.message };
    }
    if (seen.has(email)) {
      return { ...draft, status: "duplicate", error: "Уже есть выше в файле" };
    }
    seen.add(email);
    if (check.status === "typo") draft.warning = check.message;
    if (sphereRaw && !sphere) {
      draft.warning = [draft.warning, `Сфера «${sphereRaw}» не распознана — сохраним без сферы`]
        .filter(Boolean)
        .join(". ");
    }
    return draft;
  });

  const summary = {
    total: rows.length,
    ok: rows.filter((r) => r.status === "ok").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
    duplicates: rows.filter((r) => r.status === "duplicate").length,
    warnings: rows.filter((r) => r.status === "ok" && r.warning).length,
  };
  return { encoding, delimiter, hasHeader, headers, samples, mapping, rows, truncated, summary };
}

export type ImportClass = "new" | "exists" | "suppressed" | "invalid" | "duplicate";

/**
 * Итог загрузки с учётом базы: новые, уже загруженные и адреса из
 * стоп-листа — отдельными строками. Существующие контакты не трогаем
 * (источник и основание у них свои), адреса из стоп-листа не загружаем.
 */
export function classifyImport(
  rows: ImportRow[],
  existing: ReadonlySet<string>,
  suppressed: ReadonlySet<string>
): { rows: Array<ImportRow & { cls: ImportClass }>; counts: Record<ImportClass, number> } {
  const counts: Record<ImportClass, number> = { new: 0, exists: 0, suppressed: 0, invalid: 0, duplicate: 0 };
  const out = rows.map((row) => {
    let cls: ImportClass;
    if (row.status === "invalid") cls = "invalid";
    else if (row.status === "duplicate") cls = "duplicate";
    else if (suppressed.has(row.email)) cls = "suppressed";
    else if (existing.has(row.email)) cls = "exists";
    else cls = "new";
    counts[cls] += 1;
    return { ...row, cls };
  });
  return { rows: out, counts };
}

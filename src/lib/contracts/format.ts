/**
 * Мелкие правила написания для договора: даты, ФИО, должности, пустые поля.
 * Чистые функции — их проверяют тесты шаблона.
 */

export const NBSP = String.fromCharCode(0xa0);

/** Подсказки основания полномочий в форме — это текст договора, поэтому по-русски. */
export const SIGNER_BASIS_PRESETS = ["Устава", "доверенности № … от …"] as const;

/** Линия для ручного заполнения — вместо пустоты, «null» или «undefined». */
export const BLANK = "________________________";
export const BLANK_SHORT = "____________";

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD → части; некорректная дата — null. */
export function parseContractDate(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_RE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** «29» октября 2026 г. — шапка договора. */
export function contractDateLong(value: string): string {
  const parts = parseContractDate(value);
  if (!parts) return `«____» ____________ 20___${NBSP}г.`;
  const day = String(parts.day).padStart(2, "0");
  return `«${day}» ${MONTHS_GENITIVE[parts.month - 1]} ${parts.year}${NBSP}г.`;
}

/** 29.10.2026 — списки и письма. */
export function contractDateShort(value: string): string {
  const parts = parseContractDate(value);
  if (!parts) return value;
  return `${String(parts.day).padStart(2, "0")}.${String(parts.month).padStart(2, "0")}.${parts.year}`;
}

/** Сегодня по Москве, YYYY-MM-DD — дата договора по умолчанию. */
export function todayInMoscow(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Пробелы схлопнуты, края обрезаны; пустая строка — null. */
export function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text || null;
}

const isUpperCase = (value: string) => value === value.toUpperCase() && value !== value.toLowerCase();

/**
 * ФИО из ЕГРЮЛ иногда приходит капслоком («ИВАНОВ ИВАН ИВАНОВИЧ») —
 * в тексте договора пишем как имя. Обычное написание не трогаем.
 */
export function personName(value: string | null | undefined): string | null {
  const text = clean(value);
  if (!text) return null;
  if (!isUpperCase(text)) return text;
  return text
    .toLowerCase()
    .split(/(\s|-)/)
    .map((part) => (part.trim() && part !== "-" ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join("");
}

/** «Волков Денис Владимирович» → «Волков Д. В.» (с неразрывными пробелами). */
export function shortPersonName(value: string | null | undefined): string | null {
  const name = personName(value);
  if (!name) return null;
  const [surname, ...rest] = name.split(" ");
  const initials = rest
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => `${part.charAt(0).toUpperCase()}.`);
  return initials.length ? `${surname}${NBSP}${initials.join(NBSP)}` : surname;
}

/**
 * Должность в середине предложения — со строчной: «генеральный директор».
 * Капслок из ЕГРЮЛ приводим к строчным; аббревиатуры в обычном написании
 * («Директор ООО») не трогаем — меняем только первую букву.
 */
export function postInSentence(value: string | null | undefined): string | null {
  const text = clean(value);
  if (!text) return null;
  const base = isUpperCase(text) ? text.toLowerCase() : text;
  const [first, ...rest] = base.split(" ");
  // «ИП», «ГУП»: слово целиком из заглавных — это сокращение, оставляем.
  if (first.length > 1 && isUpperCase(first)) return base;
  return [first.charAt(0).toLowerCase() + first.slice(1), ...rest].join(" ");
}

/** Должность в подписи — с заглавной: «Генеральный директор». */
export function postAsTitle(value: string | null | undefined): string | null {
  const text = postInSentence(value);
  if (!text) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Значение или линия для ручного заполнения. */
export function orBlank(value: string | null | undefined, blank: string = BLANK): string {
  return clean(value) ?? blank;
}

const digitsOf = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

/** ИП: ИНН из 12 цифр или ОГРНИП из 15. */
export function isIndividualInn(inn: string | null | undefined): boolean {
  return digitsOf(inn).length === 12;
}

export function ogrnLabelFor(kind: "legal" | "individual", ogrn: string | null | undefined): "ОГРН" | "ОГРНИП" {
  return kind === "individual" || digitsOf(ogrn).length === 15 ? "ОГРНИП" : "ОГРН";
}

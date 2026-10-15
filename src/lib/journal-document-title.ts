/**
 * Человеческое автоназвание документа журнала.
 *
 * ПОЧЕМУ: раньше в диалоге «Создать документ» подставлялся штамп
 * «2026.08.27 22:05» — момент создания. Он ничего не говорил о самом
 * документе: список превращался в столбик одинаковых дат, а найти
 * «тот, что за первую половину сентября» было нельзя. Владелец
 * (2026-08-28) попросил собирать название из НАЗВАНИЯ ЖУРНАЛА и
 * ПЕРИОДА, который человек выбрал руками.
 *
 * Функции здесь чистые (никакого `new Date()` без аргументов), чтобы их
 * можно было звать прямо в обработчиках диалога и покрыть юнит-тестом.
 */
import { resolveJournalPeriodKind } from "@/lib/journal-period";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";

/** Месяцы в родительном падеже: «1 сентября 2026». */
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

/** Месяцы в именительном падеже: «сентябрь 2026» (весь месяц целиком). */
const MONTHS_NOMINATIVE = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

/** Тире-разделитель между названием журнала и периодом. */
const NAME_SEPARATOR = " — ";
/** Внутри периода — короткое тире: «1–15 сентября 2026». */
const RANGE_DASH = "–";

type ParsedDate = { year: number; month: number; day: number };

/** Разбирает `YYYY-MM-DD`. Всё остальное (пустое, мусор) → `null`. */
function parseIsoDate(value: string | null | undefined): ParsedDate | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/**
 * Длина месяца без `Date` — функция должна оставаться чистой и не
 * зависеть от таймзоны рантайма.
 */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function compare(a: ParsedDate, b: ParsedDate): number {
  return (
    a.year - b.year || a.month - b.month || a.day - b.day
  );
}

/**
 * Период человеческим текстом. Возвращает `""`, если даты не разобрать.
 *
 * - весь год        → «2026 год»
 * - весь месяц      → «сентябрь 2026»
 * - часть месяца    → «1–15 сентября 2026»
 * - один день       → «7 сентября 2026»
 * - через месяц     → «25 сентября – 8 октября 2026»
 * - через год       → «25 декабря 2026 – 8 января 2027»
 */
export function formatJournalPeriodLabel(
  dateFrom: string | null | undefined,
  dateTo?: string | null,
  locale: Locale = "ru",
): string {
  const from = parseIsoDate(dateFrom);
  if (!from) return "";
  // Дата окончания есть не у всех журналов (годовые, «на один день»):
  // тогда период — это один день начала.
  const parsedTo = parseIsoDate(dateTo);
  const to = parsedTo && compare(parsedTo, from) >= 0 ? parsedTo : from;

  if (locale !== "ru") {
    const asDate = (value: ParsedDate) => new Date(Date.UTC(value.year, value.month - 1, value.day, 12));
    const start = asDate(from), end = asDate(to);
    const year = from.year === to.year && from.month === 1 && from.day === 1 && to.month === 12 && to.day === 31;
    const month = from.year === to.year && from.month === to.month && from.day === 1 && to.day === daysInMonth(to.year, to.month);
    const format = new Intl.DateTimeFormat(FORMAT_LOCALES[locale], {
      year: "numeric", ...(year ? {} : { month: "long" as const }),
      ...(year || month ? {} : { day: "numeric" as const }), timeZone: "UTC",
    });
    return year || month || compare(from, to) === 0 ? format.format(start) : format.formatRange(start, end);
  }

  const dayFrom = `${from.day} ${MONTHS_GENITIVE[from.month - 1]}`;
  const dayTo = `${to.day} ${MONTHS_GENITIVE[to.month - 1]}`;

  if (from.year !== to.year) {
    // Через новый год год пишем у ОБЕИХ дат — иначе «25 декабря – 8 января
    // 2027» читается так, будто декабрь тоже из 2027-го.
    return `${dayFrom} ${from.year} ${RANGE_DASH} ${dayTo} ${to.year}`;
  }

  // Весь календарный год: «2026 год» короче и понятнее, чем
  // «1 января – 31 декабря 2026».
  if (from.month === 1 && from.day === 1 && to.month === 12 && to.day === 31) {
    return `${from.year} год`;
  }

  if (from.month !== to.month) {
    return `${dayFrom} ${RANGE_DASH} ${dayTo} ${from.year}`;
  }

  if (from.day === to.day) {
    return `${dayFrom} ${from.year}`;
  }

  if (from.day === 1 && to.day === daysInMonth(to.year, to.month)) {
    return `${MONTHS_NOMINATIVE[from.month - 1]} ${from.year}`;
  }

  return `${from.day}${RANGE_DASH}${to.day} ${MONTHS_GENITIVE[from.month - 1]} ${from.year}`;
}

/**
 * Итоговое автоназвание: «Гигиенический журнал — 1–15 сентября 2026».
 *
 * Если период не разобрать — остаётся одно название журнала, а если и
 * его нет — пустая строка (поле «Название документа» тогда обязательное
 * и подсветится при сабмите).
 */
export function buildJournalDocumentTitle(input: {
  journalName: string;
  dateFrom?: string | null;
  dateTo?: string | null;
}): string {
  const name = (input.journalName || "").trim();
  const period = formatJournalPeriodLabel(input.dateFrom, input.dateTo);
  if (!name) return period;
  if (!period) return name;
  return `${name}${NAME_SEPARATOR}${period}`;
}

/**
 * Период ДЛЯ НАЗВАНИЯ документа по типу журнала (`journal-period.ts`).
 *
 * Диалоги создания шлют на сервер то, что у них есть (годовые — один
 * день «Дата документа», месячные — «Дата начала»), а название должно
 * отражать период журнала: «2026 год», «сентябрь 2026», «1–15 сентября
 * 2026». Бессрочные журналы (дез. средства, интенсивное охлаждение,
 * стеклоконтроль) периода в названии не имеют — `null`.
 *
 * - `yearly`       → весь год: из `year`, иначе из года `dateFrom`
 * - `perpetual`    → `null`
 * - `half-monthly` → как пришло (bounds уже полумесячные)
 * - `single-day`   → один день `dateFrom`
 * - `monthly`/…    → если пришла одна дата (или `dateTo === dateFrom`) —
 *                    её календарный месяц; реальный диапазон — как есть
 */
export function getDocumentTitlePeriod(
  templateCode: string,
  input: {
    dateFrom?: string | null;
    dateTo?: string | null;
    year?: string | number | null;
  }
): { dateFrom: string; dateTo: string } | null {
  const kind = resolveJournalPeriodKind(templateCode);
  if (kind === "perpetual") return null;

  const from = normalizeIsoDay(input.dateFrom);
  const to = normalizeIsoDay(input.dateTo);

  if (kind === "yearly") {
    const explicitYear = Number(input.year);
    const year =
      Number.isInteger(explicitYear) && explicitYear >= 1970
        ? explicitYear
        : from
          ? Number(from.slice(0, 4))
          : null;
    if (!year) return null;
    return { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` };
  }

  if (!from) return null;
  if (kind === "half-monthly") return { dateFrom: from, dateTo: to || from };
  if (kind === "single-day") return { dateFrom: from, dateTo: from };

  if (!to || to === from) {
    const parsed = parseIsoDate(from);
    if (!parsed) return null;
    const mm = String(parsed.month).padStart(2, "0");
    const last = String(daysInMonth(parsed.year, parsed.month)).padStart(2, "0");
    return {
      dateFrom: `${parsed.year}-${mm}-01`,
      dateTo: `${parsed.year}-${mm}-${last}`,
    };
  }
  return { dateFrom: from, dateTo: to };
}

/** `YYYY-MM-DD` из строки (полный ISO тоже подходит); мусор → `""`. */
function normalizeIsoDay(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  const day = value.trim().slice(0, 10);
  return parseIsoDate(day) ? day : "";
}

/**
 * Уникальное название среди уже существующих: «Журнал уборки — 1–15
 * сентября 2026 (2)». Управляющая заводит несколько документов за один
 * период («Уборка кухни», «Уборка зала») — одинаковый дефолт давал
 * список клонов с одним именем (решение P8). Регистр и пробелы по краям
 * не учитываются.
 */
export function uniqueDocumentTitle(base: string, existing: Iterable<string>): string {
  const taken = new Set(Array.from(existing, (t) => t.trim().toLowerCase()));
  const clean = base.trim();
  if (!clean || !taken.has(clean.toLowerCase())) return clean;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${clean} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return clean;
}

/**
 * Автоназвание для диалога создания: имя журнала + период по типу
 * журнала + суффикс уникальности. Единая точка для всех диалогов и
 * серверного fallback.
 */
export function buildDocumentAutoTitle(input: {
  templateCode: string;
  journalName: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  year?: string | number | null;
  existingTitles?: Iterable<string>;
}): string {
  const period = getDocumentTitlePeriod(input.templateCode, input);
  const base = buildJournalDocumentTitle({
    journalName: input.journalName,
    dateFrom: period?.dateFrom,
    dateTo: period?.dateTo,
  });
  return input.existingTitles ? uniqueDocumentTitle(base, input.existingTitles) : base;
}

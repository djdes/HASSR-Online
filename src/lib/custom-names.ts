/**
 * Свои названия разделов меню и журналов — у каждой организации свои.
 *
 * Владелец (2026-09-25): «кому не нравятся наши названия — пусть
 * переименуют». Организация задаёт своё название в «Настройки →
 * Названия» (`/settings/names`), и его видят все её сотрудники: меню,
 * главная, список журналов, страница журнала и документа, QR-формы,
 * мини-приложение, задачи и Telegram.
 *
 * Официальное название при этом никуда не девается. Коды журналов,
 * адреса и данные не меняются, а печать (PDF), проверяющий, образцы на
 * сайте и отчёты для надзорных органов берут название из шаблона
 * журнала — проверяющему нужно именно оно. Поэтому модули печати и
 * проверяющего этот файл не импортируют (это проверяет тест).
 *
 * Хранение: `Organization.customNamesJson`
 *   { "journals": { "<код журнала>": "Своё" }, "sections": { "<ключ>": "Своё" } }
 * Пустое название не хранится — пусто значит «стандартное».
 *
 * Только чистые функции: модуль читают и сервер (помощник
 * `org-custom-names.ts`), и клиент (провайдер `custom-names-provider`).
 */

import { journalMatchesQuery, normalizeJournalSearch } from "@/lib/journal-search";
import { getDynamicRouteTitle, getRouteTitle } from "@/lib/route-titles";
import { resolveJournalCodeAlias } from "@/lib/source-journal-map";

/** Короче двух символов — не название, а опечатка. */
export const CUSTOM_NAME_MIN_LENGTH = 2;
/** Длиннее — не влезает ни в меню, ни в карточку журнала. */
export const CUSTOM_NAME_MAX_LENGTH = 80;

export type CustomNames = {
  /** Код журнала (`JournalTemplate.code`) → своё название. */
  journals: Record<string, string>;
  /** Ключ раздела (`RENAMABLE_SECTIONS[].key`) → своё название. */
  sections: Record<string, string>;
};

/** Новый пустой набор — «всё стандартное». */
export function emptyCustomNames(): CustomNames {
  return { journals: {}, sections: {} };
}

/**
 * Разделы меню, которые можно переименовать, — ровно пункты меню шапки
 * (`headerNavSections()` в `app-sections.ts`) плюс «Сотрудники». Служебные
 * пункты (Настройки, Выход, профиль) не переименовываются. Тест следит,
 * чтобы новый пункт меню не забыли добавить сюда.
 *
 * `label` — как пункт называется в меню по умолчанию.
 */
export const RENAMABLE_SECTIONS = [
  { key: "journals", href: "/journals", label: "Журналы" },
  { key: "staff", href: "/settings/users", label: "Сотрудники" },
  { key: "plans", href: "/plans", label: "Производственный план" },
  { key: "capa", href: "/capa", label: "Нарушения" },
  { key: "reports", href: "/reports", label: "Отчёты" },
  { key: "ideas", href: "/ideas", label: "Идеи" },
] as const;

export type RenamableSection = (typeof RENAMABLE_SECTIONS)[number];
export type SectionKey = RenamableSection["key"];

const SECTION_BY_KEY = new Map<string, RenamableSection>(
  RENAMABLE_SECTIONS.map((section) => [section.key, section])
);
const SECTION_BY_HREF = new Map<string, RenamableSection>(
  RENAMABLE_SECTIONS.map((section) => [section.href, section])
);

/** Код журнала: латиница, цифры, подчёркивание — как в `JournalTemplate.code`. */
const JOURNAL_CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Нормализация ввода: управляющие символы убраны, пробелы (в том числе
 * переносы строк и табуляция) схлопнуты, края обрезаны. Не строка → "".
 */
export function sanitizeCustomName(value: unknown): string {
  if (typeof value !== "string") return "";
  let visible = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    visible += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : char;
  }
  return visible.replace(/\s+/g, " ").trim();
}

/** Длина в пределах 2–80 символов (после обрезки пробелов). */
export function isCustomNameLengthOk(name: string): boolean {
  const length = Array.from(name).length;
  return length >= CUSTOM_NAME_MIN_LENGTH && length <= CUSTOM_NAME_MAX_LENGTH;
}

/**
 * Разбор `Organization.customNamesJson`. Всё битое молча отбрасывается:
 * чужие ключи, не строки, пустые и слишком длинные названия, разделы,
 * которых нет в `RENAMABLE_SECTIONS`. Любой мусор в базе означает
 * «стандартное название», а не ошибку на экране.
 */
export function parseCustomNames(raw: unknown): CustomNames {
  const out = emptyCustomNames();
  if (!isRecord(raw)) return out;
  if (isRecord(raw.journals)) {
    for (const [code, value] of Object.entries(raw.journals)) {
      if (!JOURNAL_CODE_RE.test(code)) continue;
      const name = sanitizeCustomName(value);
      if (isCustomNameLengthOk(name)) out.journals[code] = name;
    }
  }
  if (isRecord(raw.sections)) {
    for (const [key, value] of Object.entries(raw.sections)) {
      if (!SECTION_BY_KEY.has(key)) continue;
      const name = sanitizeCustomName(value);
      if (isCustomNameLengthOk(name)) out.sections[key] = name;
    }
  }
  return out;
}

/** Сколько названий организация поменяла. */
export function countCustomNames(names: CustomNames | null | undefined): number {
  if (!names) return 0;
  return Object.keys(names.journals).length + Object.keys(names.sections).length;
}

// ---------------------------------------------------------------------------
// Показ

/** Своё название журнала или null, если оставили стандартное. */
export function customJournalName(
  names: CustomNames | null | undefined,
  code: string | null | undefined
): string | null {
  if (!names || !code) return null;
  return names.journals[code] ?? names.journals[resolveJournalCodeAlias(code)] ?? null;
}

/**
 * Название журнала для человека из этой организации: своё, если задано,
 * иначе официальное. Официальное передаёт вызывающий — у него уже есть
 * `JournalTemplate.name` (или короткая подпись экрана, как в задачах).
 */
export function journalDisplayName(
  names: CustomNames | null | undefined,
  code: string | null | undefined,
  officialName: string
): string {
  return customJournalName(names, code) ?? officialName;
}

/**
 * Шаблоны журналов с названием для этой организации: `name` — своё или
 * официальное, `officialName` — всегда официальное (для подсказки и
 * поиска). Только для показа: в данные, печать и задачи TasksFlow
 * по-прежнему идёт `officialName`.
 */
export function withJournalDisplayNames<T extends { code: string; name: string }>(
  templates: readonly T[],
  names: CustomNames
): Array<T & { officialName: string }> {
  return templates.map((template) => ({
    ...template,
    officialName: template.name,
    name: journalDisplayName(names, template.code, template.name),
  }));
}

/** Раздел меню по ключу. */
export function renamableSection(key: string): RenamableSection | null {
  return SECTION_BY_KEY.get(key) ?? null;
}

/** Своё название раздела или null. */
export function customSectionName(
  names: CustomNames | null | undefined,
  key: string
): string | null {
  if (!names) return null;
  return names.sections[key] ?? null;
}

/** Название раздела: своё, иначе стандартное (или переданное `fallback`). */
export function sectionDisplayName(
  names: CustomNames | null | undefined,
  key: SectionKey,
  fallback?: string
): string {
  return customSectionName(names, key) ?? fallback ?? SECTION_BY_KEY.get(key)?.label ?? key;
}

/**
 * Своё название раздела по адресу страницы (`/journals`, `/settings/users`)
 * или null. Так его находят меню, хлебные крошки и быстрый поиск — у них
 * на руках адрес, а не ключ.
 */
export function customSectionNameByHref(
  names: CustomNames | null | undefined,
  href: string | null | undefined
): string | null {
  if (!names || !href) return null;
  const clean = href.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  const section = SECTION_BY_HREF.get(clean);
  return section ? customSectionName(names, section.key) : null;
}

/**
 * Своё название раздела для заголовка страницы по её адресу — или null.
 *
 * Повторяет подъём по пути, которым заголовок ищет ближайший известный
 * раздел (`titleForSitePath` в оболочке мини-приложения): у
 * `/journals/hygiene/documents/1` заголовок — раздел `/journals`. Своё
 * название подставляется, только если этот ближайший раздел и есть
 * переименованный пункт меню, иначе остаётся прежний заголовок.
 */
export function customSectionTitleForPath(
  names: CustomNames | null | undefined,
  pathname: string
): string | null {
  if (!names || getDynamicRouteTitle(pathname)) return null;
  let path = pathname.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  while (path.length > 1) {
    if (getRouteTitle(path)) return customSectionNameByHref(names, path);
    path = path.slice(0, path.lastIndexOf("/")) || "/";
  }
  return null;
}

/**
 * Поля для поиска журнала: своё название, официальное и остальное, что
 * передал экран (описание, код). Поиск находит журнал и по тому, как его
 * называют в заведении, и по официальному названию из СанПиН.
 */
export function journalSearchFields(
  names: CustomNames | null | undefined,
  code: string,
  officialName: string,
  ...extra: Array<string | null | undefined>
): Array<string | null | undefined> {
  return [customJournalName(names, code), officialName, ...extra];
}

/** Совпадает ли журнал с запросом — по своему или официальному названию. */
export function journalMatchesCustomQuery(
  names: CustomNames | null | undefined,
  code: string,
  officialName: string,
  query: string,
  ...extra: Array<string | null | undefined>
): boolean {
  return journalMatchesQuery(journalSearchFields(names, code, officialName, ...extra), query);
}

// ---------------------------------------------------------------------------
// Сохранение

export type CustomNameKind = "journal" | "section";

export type CustomNameFieldError = {
  kind: CustomNameKind;
  key: string;
  message: string;
};

export type CustomNamesValidation =
  | { ok: true; names: CustomNames }
  | { ok: false; message: string; errors: CustomNameFieldError[] };

export const CUSTOM_NAME_LENGTH_ERROR = `От ${CUSTOM_NAME_MIN_LENGTH} до ${CUSTOM_NAME_MAX_LENGTH} символов`;

/** Одинаковые для человека названия: регистр, «ё» и лишние пробелы не важны. */
function sameName(left: string, right: string): boolean {
  return normalizeJournalSearch(left) === normalizeJournalSearch(right);
}

/**
 * Разбор полей страницы «Названия»: что сохранится и какие поля с ошибкой.
 * Страница зовёт это на каждое изменение (подсветка поля и счётчик
 * «Изменений: N»), сервер — через `validateCustomNamesInput`. Правила одни.
 *
 * Правила:
 *   • пустое поле (или только пробелы) — стандартное название, не ошибка;
 *   • своё название — от 2 до 80 символов после обрезки пробелов;
 *   • название, совпадающее со стандартным, не храним (это и есть стандартное);
 *   • два журнала (или два раздела) не могут называться одинаково — иначе
 *     в списке их не отличить;
 *   • журналы — только из каталога (`journalOfficialNames`), разделы —
 *     только из `RENAMABLE_SECTIONS`.
 */
export function checkCustomNamesInput(
  input: { journals?: unknown; sections?: unknown },
  journalOfficialNames: Readonly<Record<string, string>>
): { names: CustomNames; errors: CustomNameFieldError[] } {
  const errors: CustomNameFieldError[] = [];
  const names = emptyCustomNames();
  const rawJournals = isRecord(input.journals) ? input.journals : {};
  const rawSections = isRecord(input.sections) ? input.sections : {};

  for (const [code, value] of Object.entries(rawJournals)) {
    const official = journalOfficialNames[code];
    if (official === undefined) {
      errors.push({ kind: "journal", key: code, message: "Такого журнала нет" });
      continue;
    }
    if (value !== null && value !== undefined && typeof value !== "string") {
      errors.push({ kind: "journal", key: code, message: "Название должно быть текстом" });
      continue;
    }
    const name = sanitizeCustomName(value);
    if (!name || sameName(name, official)) continue;
    if (!isCustomNameLengthOk(name)) {
      errors.push({ kind: "journal", key: code, message: CUSTOM_NAME_LENGTH_ERROR });
      continue;
    }
    names.journals[code] = name;
  }

  for (const [key, value] of Object.entries(rawSections)) {
    const section = SECTION_BY_KEY.get(key);
    if (!section) {
      errors.push({ kind: "section", key, message: "Такого раздела нет" });
      continue;
    }
    if (value !== null && value !== undefined && typeof value !== "string") {
      errors.push({ kind: "section", key, message: "Название должно быть текстом" });
      continue;
    }
    const name = sanitizeCustomName(value);
    if (!name || sameName(name, section.label)) continue;
    if (!isCustomNameLengthOk(name)) {
      errors.push({ kind: "section", key, message: CUSTOM_NAME_LENGTH_ERROR });
      continue;
    }
    names.sections[key] = name;
  }

  // Повторы: своё название не должно совпадать ни с чужим своим, ни с
  // официальным названием другого журнала (раздела).
  errors.push(
    ...duplicateErrors(
      "journal",
      names.journals,
      Object.entries(journalOfficialNames).map(([code, official]) => ({
        key: code,
        display: names.journals[code] ?? official,
        official,
      }))
    ),
    ...duplicateErrors(
      "section",
      names.sections,
      RENAMABLE_SECTIONS.map((section) => ({
        key: section.key,
        display: names.sections[section.key] ?? section.label,
        official: section.label,
      }))
    )
  );

  return { names, errors };
}

/** Проверка тела запроса `PUT /api/settings/custom-names` — те же правила. */
export function validateCustomNamesInput(
  input: unknown,
  journalOfficialNames: Readonly<Record<string, string>>
): CustomNamesValidation {
  if (!isRecord(input)) {
    return { ok: false, message: "Нет данных для сохранения", errors: [] };
  }
  const { journals = {}, sections = {} } = input;
  if (!isRecord(journals) || !isRecord(sections)) {
    return { ok: false, message: "Неверный формат названий", errors: [] };
  }
  const { names, errors } = checkCustomNamesInput({ journals, sections }, journalOfficialNames);
  if (errors.length > 0) {
    const first = errors[0];
    const where =
      first.kind === "section"
        ? `Раздел «${SECTION_BY_KEY.get(first.key)?.label ?? first.key}»`
        : `Журнал «${journalOfficialNames[first.key] ?? first.key}»`;
    const text = first.message.charAt(0).toLocaleLowerCase("ru-RU") + first.message.slice(1);
    return { ok: false, message: `${where}: ${text}`, errors };
  }
  return { ok: true, names };
}

function duplicateErrors(
  kind: CustomNameKind,
  custom: Record<string, string>,
  all: Array<{ key: string; display: string; official: string }>
): CustomNameFieldError[] {
  const errors: CustomNameFieldError[] = [];
  for (const [key, name] of Object.entries(custom)) {
    const clash = all.find((item) => item.key !== key && sameName(item.display, name));
    if (!clash) continue;
    const what = kind === "journal" ? "журнал" : "раздел";
    errors.push({
      kind,
      key,
      message:
        custom[clash.key] !== undefined
          ? `Так уже назван ${what} «${clash.official}»`
          : `Так называется ${what} «${clash.official}»`,
    });
  }
  return errors;
}

/** Одна правка для журнала действий. null — стандартное название. */
export type CustomNameChange = {
  kind: CustomNameKind;
  key: string;
  /** Стандартное (официальное) название. */
  standard: string;
  from: string | null;
  to: string | null;
};

/** Что поменялось между двумя наборами — в порядке разделов, затем журналов. */
export function diffCustomNames(
  before: CustomNames,
  after: CustomNames,
  journalOfficialNames: Readonly<Record<string, string>>
): CustomNameChange[] {
  const changes: CustomNameChange[] = [];
  for (const section of RENAMABLE_SECTIONS) {
    const from = before.sections[section.key] ?? null;
    const to = after.sections[section.key] ?? null;
    if (from !== to) {
      changes.push({ kind: "section", key: section.key, standard: section.label, from, to });
    }
  }
  const codes = new Set([...Object.keys(before.journals), ...Object.keys(after.journals)]);
  for (const code of codes) {
    const from = before.journals[code] ?? null;
    const to = after.journals[code] ?? null;
    if (from === to) continue;
    changes.push({
      kind: "journal",
      key: code,
      standard: journalOfficialNames[code] ?? code,
      from,
      to,
    });
  }
  return changes;
}

/** Подпись «стандартного» значения в журнале действий. */
export const STANDARD_NAME_AUDIT_LABEL = "стандартное";

/**
 * Детали записи `AuditLog`: «что было → что стало» по каждому названию.
 * Формат `{ from, to }` журнал действий показывает строкой «было → стало».
 */
export function customNamesAuditDetails(changes: CustomNameChange[]): Record<string, unknown> {
  const details: Record<string, unknown> = { count: changes.length };
  for (const change of changes) {
    const label =
      change.kind === "section" ? `Раздел «${change.standard}»` : `Журнал «${change.standard}»`;
    details[label] = {
      from: change.from ?? STANDARD_NAME_AUDIT_LABEL,
      to: change.to ?? STANDARD_NAME_AUDIT_LABEL,
    };
  }
  return details;
}

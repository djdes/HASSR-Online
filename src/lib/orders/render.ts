/**
 * Сборка текста приказа из шаблона, реквизитов организации и значений
 * формы.
 *
 * Чистые функции без prisma: их зовёт и серверный PDF, и клиентский
 * предпросмотр, и unit-тесты. Всё, что нужно от базы, вызывающий
 * приносит готовым `OrderOrgSnapshot`.
 *
 * Незаполненный плейсхолдер превращается в прочерк, а не остаётся
 * `{{responsibleName}}`: приказ печатают и подписывают на бумаге, и
 * прочерк там честнее — его видно и можно дописать ручкой. Оставленная
 * фигурная скобка выглядела бы как поломка вёрстки.
 */

import type { OrderTemplate } from "./catalog";

/** Длинный прочерк для незаполненного поля. */
export const BLANK = "___________________";

/**
 * Реквизиты организации на момент издания приказа.
 * Собирается из `Organization` + `LegalProfile` в `./org-snapshot`.
 */
export type OrderOrgSnapshot = {
  /** Полное название с ОПФ: «Общество с ограниченной ответственностью „Ромашка“». */
  orgName: string;
  /** Короткое: «ООО „Ромашка“». */
  orgShortName: string;
  orgInn: string | null;
  orgAddress: string | null;
  directorName: string | null;
  directorPost: string | null;
  city: string | null;
};

export type OrderValues = Record<string, string>;

export type RenderedOrder = {
  /** «ПРИКАЗ № 12-ОД» */
  heading: string;
  title: string;
  /** «г. Москва» */
  city: string;
  /** «10 сентября 2026 г.» */
  dateLine: string;
  /** Преамбула со ссылками на нормативы. */
  preamble: string;
  /** Абзацы постановляющей части. */
  body: string[];
  /** Подпись: должность, прочерк, расшифровка. */
  signature: { post: string; name: string };
  /** Поля, обязательные по шаблону, но незаполненные. */
  missingFields: string[];
};

const MONTHS_RU = [
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

/**
 * Дата по-русски: «10 сентября 2026 г.».
 *
 * Принимает и `Date`, и строку `YYYY-MM-DD` из `<input type="date">`.
 * Строку разбираем вручную, а не через `new Date(value)`: там UTC, и в
 * часовых поясах восточнее Гринвича дата уезжала бы на день назад.
 */
export function formatOrderDate(value: Date | string | null | undefined): string {
  if (!value) return BLANK;

  let year: number;
  let month: number;
  let day: number;

  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (!match) return value.trim() || BLANK;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    year = value.getFullYear();
    month = value.getMonth() + 1;
    day = value.getDate();
  }

  const monthName = MONTHS_RU[month - 1];
  if (!monthName) return BLANK;
  return `${day} ${monthName} ${year} г.`;
}

/**
 * Подстановка `{{key}}`. Значения не экранируются: результат уходит в
 * PDF и в React как текстовый узел, HTML тут не собирается.
 */
export function fillPlaceholders(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value && value.trim() !== "" ? value.trim() : BLANK;
  });
}

/**
 * Словарь подстановок: реквизиты организации + значения формы.
 * Поля формы идут последними и могут перекрыть одноимённый реквизит —
 * это осознанно: человек в форме главнее справочника.
 */
function buildDictionary(
  org: OrderOrgSnapshot,
  values: OrderValues,
  meta: { number: string; issuedAt: Date | string }
): Record<string, string> {
  const dictionary: Record<string, string> = {
    orgName: org.orgName,
    orgShortName: org.orgShortName,
    orgInn: org.orgInn ?? "",
    orgAddress: org.orgAddress ?? "",
    directorName: org.directorName ?? "",
    directorPost: org.directorPost ?? "",
    city: org.city ?? "",
    number: meta.number,
    issuedAt: formatOrderDate(meta.issuedAt),
  };

  for (const [key, value] of Object.entries(values)) {
    // Дата из <input type="date"> печатается по-русски, иначе в тексте
    // приказа осталось бы «2026-09-10».
    dictionary[key] = /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
      ? formatOrderDate(value)
      : value;
  }

  return dictionary;
}

/**
 * Основание в родительном падеже — для «В соответствии с требованиями …».
 * В каталоге основания записаны в именительном («Приказ Минздрава…»), как их
 * показывают в списках; аббревиатуры (СанПиН, ТР ТС, СП) не склоняются.
 */
const GENITIVE_PREFIXES: [RegExp, string][] = [
  // `\b` в JS не видит границу кириллического слова — только пробел после.
  [/^Приказ(?=\s)/, "приказа"],
  [/^Федеральный закон(?=\s)/, "Федерального закона"],
  [/^Трудовой кодекс(?=\s)/, "Трудового кодекса"],
  [/^Постановление(?=\s)/, "постановления"],
];

export function basisInGenitive(basis: string): string {
  for (const [pattern, genitive] of GENITIVE_PREFIXES) {
    if (pattern.test(basis)) return basis.replace(pattern, genitive);
  }
  return basis;
}

/** Преамбула: перечисление нормативных оснований. */
function buildPreamble(template: OrderTemplate, org: OrderOrgSnapshot): string {
  const basis = template.basis.map(basisInGenitive).join("; ");
  const where = org.orgName || org.orgShortName;
  return `В соответствии с требованиями ${basis}, в целях обеспечения безопасности пищевой продукции на предприятии ${where}`;
}

/**
 * Собрать приказ целиком.
 *
 * `missingFields` возвращаем отдельно, чтобы форма могла подсветить
 * незаполненное, а PDF — всё равно напечататься с прочерками: приказ
 * часто дозаполняют ручкой уже на бумаге.
 */
export function renderOrder(input: {
  template: OrderTemplate;
  org: OrderOrgSnapshot;
  values: OrderValues;
  number: string;
  issuedAt: Date | string;
}): RenderedOrder {
  const { template, org, values, number, issuedAt } = input;
  const dictionary = buildDictionary(org, values, { number, issuedAt });

  const missingFields = template.fields
    .filter((field) => field.required)
    .filter((field) => !(values[field.key] ?? "").trim())
    .map((field) => field.label);

  // Многострочные поля (состав группы, перечень журналов) разворачиваем
  // в отдельные абзацы: иначе весь список слипся бы в одну строку.
  const body = template.body.flatMap((line) => {
    const filled = fillPlaceholders(line, dictionary);
    return filled.includes("\n")
      ? filled.split("\n").map((part) => part.trim()).filter(Boolean)
      : [filled];
  });

  return {
    heading: `ПРИКАЗ № ${number.trim() || BLANK}`,
    title: template.title,
    city: org.city ? `г. ${org.city}` : BLANK,
    dateLine: formatOrderDate(issuedAt),
    preamble: `${buildPreamble(template, org)}, ПРИКАЗЫВАЮ:`,
    body,
    signature: {
      post: org.directorPost || "Руководитель",
      name: org.directorName || BLANK,
    },
    missingFields,
  };
}

/**
 * Значения по умолчанию для пустой формы. Даты подставляем сегодняшние —
 * приказ почти всегда издают текущим днём.
 */
export function defaultOrderValues(
  template: OrderTemplate,
  today = new Date()
): OrderValues {
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const values: OrderValues = {};
  for (const field of template.fields) {
    if (field.defaultValue) values[field.key] = field.defaultValue;
    else if (field.kind === "date") values[field.key] = iso;
    else values[field.key] = "";
  }
  return values;
}

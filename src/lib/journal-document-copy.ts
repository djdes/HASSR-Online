/**
 * «Сделать копию» документа журнала — одна общая чистая функция.
 *
 * ПОЧЕМУ: копию умели делать семь журналов, и каждый — по-своему. Общие
 * болезни были такие:
 *   • копировался ФАКТ: подписи и даты подписания в протоколе аудита,
 *     помесячные отметки «сделано» в ТО и генуборках, дата последней
 *     поверки в поверке, галочки и значения строк в плане аудита;
 *   • пять из семи брали период ИСТОЧНИКА — копия рождалась задним
 *     числом, сервер отвечал «за этот период уже есть документ», и
 *     кнопка выглядела сломанной;
 *   • название повторяло исходное — в списке появлялись близнецы.
 *
 * Правило копии: переносим СТРУКТУРУ (состав строк, оборудования,
 * помещений, разделов, требований, настройки колонок, ответственных и
 * утверждающего), обнуляем факт, подписи, даты закрытия и ссылки на
 * документ-источник. Период — следующий по правилу журнала
 * (`journal-period.ts`), но не раньше текущего. Название — автоназвание
 * на новый период, с суффиксом уникальности, если такое уже занято.
 *
 * Функция чистая: никакого `new Date()` без аргумента, никакой БД —
 * поэтому её можно звать прямо в обработчике пункта меню и покрыть
 * юнит-тестом по каждому журналу.
 */
import { resolveJournalPeriod, resolveJournalPeriodKind } from "@/lib/journal-period";
import { buildDocumentAutoTitle } from "@/lib/journal-document-title";
import { copySanitationRowToYear } from "@/lib/sanitation-day-document";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DocumentCopyPeriod = { dateFrom: string; dateTo: string };

export type DocumentCopyResult = {
  /** Период нового документа, `YYYY-MM-DD`. */
  dateFrom: string;
  dateTo: string;
  /** Название нового документа. */
  title: string;
  /** Конфиг-структура без факта. */
  config: Record<string, unknown>;
};

function toIsoDay(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  const day = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

function parseUtc(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object" && !Array.isArray(row)
      )
    : [];
}

/** Все значения объекта-словаря заменяются на пустую строку. */
function blankValues(value: unknown): Record<string, string> {
  const source = asRecord(value);
  const out: Record<string, string> = {};
  for (const key of Object.keys(source)) out[key] = "";
  return out;
}

/**
 * Период копии: следующий после источника по правилу журнала, но не
 * раньше текущего.
 *
 * Источник нормализуем правилом журнала: у части документов в базе
 * лежит «один день» (дата документа), а по смыслу это год или месяц —
 * иначе «следующий» посчитался бы от этого одного дня.
 */
export function resolveDocumentCopyPeriod(
  templateCode: string,
  sourcePeriod: DocumentCopyPeriod,
  today: string
): DocumentCopyPeriod {
  const todayIso = toIsoDay(today) || toIsoDay(sourcePeriod.dateFrom);
  const kind = resolveJournalPeriodKind(templateCode);
  const currentPeriod = resolveJournalPeriod(templateCode, parseUtc(todayIso));

  // Бессрочный журнал периодов не ротирует — копия живёт «с сегодня».
  if (kind === "perpetual") {
    return {
      dateFrom: currentPeriod.dateFrom.toISOString().slice(0, 10),
      dateTo: currentPeriod.dateTo.toISOString().slice(0, 10),
    };
  }

  const sourceFrom = toIsoDay(sourcePeriod.dateFrom);
  if (!sourceFrom) {
    return {
      dateFrom: currentPeriod.dateFrom.toISOString().slice(0, 10),
      dateTo: currentPeriod.dateTo.toISOString().slice(0, 10),
    };
  }
  const sourceRule = resolveJournalPeriod(templateCode, parseUtc(sourceFrom));
  const nextStart = new Date(sourceRule.dateTo.getTime() + DAY_MS);
  // Копия старого документа не должна уезжать в прошлое: если следующий
  // период уже прошёл, берём текущий.
  const start =
    nextStart.getTime() < currentPeriod.dateFrom.getTime()
      ? currentPeriod.dateFrom
      : nextStart;
  const period = resolveJournalPeriod(templateCode, start);
  return {
    dateFrom: period.dateFrom.toISOString().slice(0, 10),
    dateTo: period.dateTo.toISOString().slice(0, 10),
  };
}

/**
 * Поля, которые в копии не имеют смысла ни в одном журнале:
 * дата закрытия документа и ссылки на документ-источник.
 */
function stripCommonFactFields(config: Record<string, unknown>) {
  delete config.closedAt;
  delete config.finishedAt;
  delete config.sourcePlanDocumentId;
  delete config.sourcePlanTitle;
  delete config.sourceProtocolDocumentId;
  delete config.sourceProtocolTitle;
}

/**
 * Обнуление факта — по журналам. Структура строк остаётся на месте.
 * `periodFrom` — начало нового периода (для журналов, где даты плана
 * переезжают вместе с годом).
 */
function resetFactByTemplate(
  templateCode: string,
  config: Record<string, unknown>,
  periodFrom: string
) {
  switch (templateCode) {
    // План внутреннего аудита: состав разделов, требований и колонок —
    // структура; галочка «проверено» и значения по колонкам — факт.
    case "audit_plan": {
      config.rows = asRows(config.rows).map((row) => ({
        ...row,
        checked: false,
        values: {},
      }));
      break;
    }
    // Протокол аудита: текст требований остаётся, результат «да/нет»,
    // замечание и подписи — факт конкретной проверки. У подписи роль
    // остаётся (это состав комиссии), имя и дата подписания — нет.
    case "audit_protocol": {
      config.rows = asRows(config.rows).map((row) => {
        const next: Record<string, unknown> = { ...row, result: "", note: "" };
        delete next.planRowId;
        return next;
      });
      config.signatures = asRows(config.signatures).map((signature) => ({
        ...signature,
        name: "",
        signedAt: "",
      }));
      break;
    }
    // Поверка средств измерений: перечень приборов — структура, дата
    // последней поверки — факт прошлого года.
    case "equipment_calibration": {
      config.rows = asRows(config.rows).map((row) => ({
        ...row,
        lastCalibrationDate: "",
      }));
      break;
    }
    // ТО оборудования: план по месяцам — структура, `fact` — отметки
    // «сделано».
    case "equipment_maintenance": {
      config.rows = asRows(config.rows).map((row) => ({
        ...row,
        fact: blankValues(row.fact),
      }));
      break;
    }
    // График генуборок. Строки нового формата (`cleanings`, 2026-09-22):
    // плановые даты переезжают на те же числа нового года, отметки о
    // выполнении и внеплановые уборки остаются в старом документе,
    // заметки плана сохраняются, заметки факта — нет. Строки старого
    // формата — как раньше: план как есть, факт пустой.
    case "general_cleaning": {
      const targetYear = Number(periodFrom.slice(0, 4));
      const sourceYear =
        typeof config.year === "number" && Number.isFinite(config.year)
          ? config.year
          : targetYear;
      config.rows = asRows(config.rows).map((row) =>
        Array.isArray(row.cleanings)
          ? (copySanitationRowToYear(row, sourceYear, targetYear) as unknown as Record<string, unknown>)
          : { ...row, fact: blankValues(row.fact) }
      );
      break;
    }
    // Перечень стеклянных изделий: сама опись — это и есть структура,
    // список изделий в копии остаётся целиком. Отметок контроля в
    // модели строки нет (`GlassListRow` = место, изделие, количество),
    // обнулять нечего.
    case "glass_items_list":
      break;
    // Чек-лист санитарного дня: зоны, пункты и принципы — структура,
    // а отметки живут в записях документа, не в конфиге.
    case "sanitary_day_control":
      break;
    default:
      break;
  }
}

/**
 * Журналы, у которых есть «Сделать копию» и для которых
 * `copyDocumentStructure` знает, где в конфиге структура, а где факт.
 * Для остальных журналов конфиг может целиком состоять из факта
 * (бракераж, аварии…) — копировать его нельзя.
 */
export const DOCUMENT_COPY_SUPPORTED_CODES: ReadonlySet<string> = new Set([
  "audit_plan",
  "audit_protocol",
  "equipment_calibration",
  "equipment_maintenance",
  "general_cleaning",
  "glass_items_list",
  "sanitary_day_control",
]);

/**
 * Структура документа на новый период: общие поля факта убраны, факт
 * журнала обнулён, год и дата документа — от начала нового периода.
 * Исходный конфиг не меняется.
 *
 * `periodFrom` — `YYYY-MM-DD` начала нового периода. Имеет смысл для
 * журналов из `DOCUMENT_COPY_SUPPORTED_CODES`.
 */
export function copyDocumentStructure(
  templateCode: string,
  sourceConfig: unknown,
  periodFrom: string
): Record<string, unknown> {
  const config = asRecord(sourceConfig);
  stripCommonFactFields(config);
  resetFactByTemplate(templateCode, config, periodFrom);

  // Год и дата документа в шапке — от нового периода, иначе бланк
  // напечатается с прошлогодней датой.
  if ("year" in config) config.year = Number(periodFrom.slice(0, 4));
  if ("documentDate" in config) config.documentDate = periodFrom;
  return config;
}

/**
 * Копия документа: структура без факта, следующий период, уникальное имя.
 *
 * `today` и `sourcePeriod` — строки `YYYY-MM-DD`; `existingTitles` —
 * названия документов этого журнала, чтобы копия не стала близнецом.
 */
export function buildDocumentCopy(args: {
  templateCode: string;
  journalName: string;
  sourceConfig: unknown;
  sourcePeriod: DocumentCopyPeriod;
  today: string;
  existingTitles?: Iterable<string>;
}): DocumentCopyResult {
  const period = resolveDocumentCopyPeriod(
    args.templateCode,
    args.sourcePeriod,
    args.today
  );
  const config = copyDocumentStructure(
    args.templateCode,
    args.sourceConfig,
    period.dateFrom
  );

  const title = buildDocumentAutoTitle({
    templateCode: args.templateCode,
    journalName: args.journalName,
    dateFrom: period.dateFrom,
    dateTo: period.dateTo,
    existingTitles: args.existingTitles ?? [],
  });
  // У части журналов название документа продублировано в конфиге —
  // держим его в согласии с самим документом.
  if ("documentName" in config) config.documentName = title;

  return { dateFrom: period.dateFrom, dateTo: period.dateTo, title, config };
}

/**
 * Автоматизация журналов: «автосоздание документов + ежедневное
 * автозаполнение».
 *
 * Почему отдельный helper. Раньше автосоздание жило в плоском списке
 * `Organization.autoJournalCodes`, а автозаполнение — в поле каждого
 * ДОКУМЕНТА (`JournalDocument.autoFill`), которое управляющая включала
 * руками на каждом новом документе. В результате автосозданный документ
 * никогда не автозаполнялся: cron автосоздания ставил `autoFill:false`,
 * а cron автозаполнения смотрел только на `autoFill:true`.
 *
 * Теперь обе половинки лежат в одном месте — `Organization.journalAutomationJson`:
 *   { [journalCode]: { autoCreate: boolean, autoFill: boolean } }
 *
 * Одна галочка в UI пишет оба флага сразу; раздельные флаги оставлены
 * под будущий «продвинутый» режим (например, создавать документы, но
 * заполнять руками).
 */

import {
  AUTOFILL_SUPPORTED_CODES,
  getAutofillCapability,
} from "@/lib/journal-autofill-capability";

/**
 * Политика ответственных для АВТОСОЗДАВАЕМЫХ документов журнала.
 *
 *   • inherit — «как в последнем журнале»: ответственный/проверяющий
 *     наследуются из последнего документа шаблона (с валидацией «жив,
 *     активен, эта орга»), при провале — штатный каскад
 *     слоты → keywords → ростер.
 *   • custom  — явно выбранные люди. Невалидный id (уволен/чужая орга)
 *     не роняет создание — каскад валидации падает на следующий шаг.
 *
 * ОТСУТСТВИЕ ключа = легаси-поведение (штатный каскад) — существующие
 * организации ничего не замечают.
 */
export type JournalAutomationResponsibles =
  | { mode: "inherit" }
  | {
      mode: "custom";
      responsibleUserId: string;
      verifierUserId: string | null;
    };

/**
 * Политика списка сотрудников (строк) для per-employee журналов
 * (гигиена, здоровье).
 *
 *   • inherit — строки последнего документа (активные) ∪ новые
 *     сотрудники, подходящие по должностям, нанятые после его создания.
 *   • custom  — ровно выбранные ∩ активные; новички НЕ добавляются сами.
 *
 * Отсутствие ключа = легаси (должности из JobPositionJournalAccess →
 * весь ростер). Пустой результат любой ветки → легаси-фолбэк: журнал
 * с нулём строк не создаём никогда.
 */
export type JournalAutomationStaff =
  | { mode: "inherit" }
  | { mode: "custom"; userIds: string[] };

export type JournalAutomation = {
  /** Cron 06:00 заводит документ на текущий период, если его нет. */
  autoCreate: boolean;
  /** Cron 06:00 заполняет сегодняшний день по графику сотрудников. */
  autoFill: boolean;
  /** Ответственные для новых автосозданных документов. */
  responsibles?: JournalAutomationResponsibles;
  /** Список сотрудников-строк (только per-employee журналы). */
  staff?: JournalAutomationStaff;
};

export type JournalAutomationMap = Record<string, JournalAutomation>;

/** Форма организации, которой достаточно для чтения настройки. */
export type JournalAutomationOrg = {
  journalAutomationJson?: unknown;
  autoJournalCodes?: unknown;
};

/**
 * Журналы, у которых автоматика включена «из коробки» у новых
 * организаций. Гигиенический — самый частый ежедневный (строка на
 * сотрудника × день). Журнал здоровья сюда НЕ входит: он выключен по
 * умолчанию (см. health-check-default-off.ts), и автоматика для
 * выключенного журнала плодила бы документы, которых никто не видит.
 */
export const AUTOMATION_DEFAULT_ON_CODES = ["hygiene"] as const;

/**
 * Журналы, которые автоматика вообще умеет обслуживать (для остальных
 * тумблер автозаполнения не показываем). Делегируется capability-карте
 * `journal-autofill-capability.ts` — единственному месту, где живёт
 * список поддерживаемых кодов и их механика.
 */
export const AUTOMATION_SUPPORTED_CODES = AUTOFILL_SUPPORTED_CODES;

export function isAutomationSupported(code: string): boolean {
  return getAutofillCapability(code) !== null;
}

/**
 * Журналы «строка = сотрудник» (гигиена, здоровье). Гейт секции
 * «Сотрудники» в модалке включения и применения staff-политики.
 */
export function isPerEmployeeJournal(code: string): boolean {
  return getAutofillCapability(code) === "staff";
}

/** Включена ли автоматика по умолчанию для этого кода журнала. */
export function isAutomationDefaultOn(code: string): boolean {
  return (AUTOMATION_DEFAULT_ON_CODES as readonly string[]).includes(code);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Разбирает политику ответственных. Мусор → undefined (= легаси).
 * У custom обязателен непустой `responsibleUserId`; `verifierUserId`
 * опционален (null = «проверяющего каскад подберёт сам»).
 */
export function parseResponsibles(
  value: unknown
): JournalAutomationResponsibles | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  if (row.mode === "inherit") return { mode: "inherit" };
  if (row.mode === "custom") {
    const responsibleUserId =
      typeof row.responsibleUserId === "string" && row.responsibleUserId
        ? row.responsibleUserId
        : null;
    if (!responsibleUserId) return undefined;
    return {
      mode: "custom",
      responsibleUserId,
      verifierUserId:
        typeof row.verifierUserId === "string" && row.verifierUserId
          ? row.verifierUserId
          : null,
    };
  }
  return undefined;
}

/**
 * Разбирает staff-политику. Мусор → undefined (= легаси). В custom
 * остаются только непустые строки — `userIds: [42]` даёт пустой список,
 * который резолвер трактует как легаси-фолбэк.
 */
export function parseStaff(value: unknown): JournalAutomationStaff | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  if (row.mode === "inherit") return { mode: "inherit" };
  if (row.mode === "custom") {
    const userIds = Array.isArray(row.userIds)
      ? row.userIds.filter(
          (item): item is string => typeof item === "string" && item.length > 0
        )
      : [];
    return { mode: "custom", userIds };
  }
  return undefined;
}

/** Разбирает JSON-поле в типизированную карту, молча выкидывая мусор. */
export function parseJournalAutomationJson(value: unknown): JournalAutomationMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const map: JournalAutomationMap = {};
  for (const [code, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const entry: JournalAutomation = {
      autoCreate: row.autoCreate === true,
      autoFill: row.autoFill === true,
    };
    const responsibles = parseResponsibles(row.responsibles);
    if (responsibles) entry.responsibles = responsibles;
    const staff = parseStaff(row.staff);
    if (staff) entry.staff = staff;
    map[code] = entry;
  }
  return map;
}

/**
 * Настройка автоматики для журнала.
 *
 * Fallback обязателен: организации, настроившие автосоздание ДО
 * появления `journalAutomationJson`, держат список в `autoJournalCodes`.
 * Молча потерять его нельзя — иначе после деплоя у них перестанут
 * создаваться документы.
 */
export function getJournalAutomation(
  org: JournalAutomationOrg | null | undefined,
  code: string
): JournalAutomation {
  const map = parseJournalAutomationJson(org?.journalAutomationJson);
  const explicit = map[code];
  if (explicit) return explicit;
  return {
    autoCreate: toStringArray(org?.autoJournalCodes).includes(code),
    autoFill: false,
  };
}

/** Тумблер «одной галочкой»: журнал ведётся автоматикой целиком. */
export function isJournalAutomationEnabled(
  org: JournalAutomationOrg | null | undefined,
  code: string
): boolean {
  const value = getJournalAutomation(org, code);
  return value.autoCreate && value.autoFill;
}

/**
 * Чистое обновление карты. Возвращает НОВЫЙ объект — вызывающий сам
 * решает, писать его в БД или показать превью.
 */
export function withJournalAutomation(
  current: unknown,
  code: string,
  value: JournalAutomation
): JournalAutomationMap {
  const map = parseJournalAutomationJson(current);
  const entry: JournalAutomation = {
    autoCreate: value.autoCreate,
    autoFill: value.autoFill,
  };
  if (value.responsibles) entry.responsibles = value.responsibles;
  if (value.staff) entry.staff = value.staff;
  return { ...map, [code]: entry };
}

/**
 * Дефолт новой организации. Гигиенический журнал ведётся сам с первого
 * дня — иначе новая компания месяц не подозревает, что автоматика есть.
 */
export function defaultJournalAutomationJson(): JournalAutomationMap {
  const map: JournalAutomationMap = {};
  for (const code of AUTOMATION_DEFAULT_ON_CODES) {
    map[code] = { autoCreate: true, autoFill: true };
  }
  return map;
}

/**
 * Все коды, которые нужно обслужить cron'у автоматизации: у кого
 * `autoCreate` включён явно ЛИБО через легаси-список.
 */
export function listAutomationCodes(
  org: JournalAutomationOrg | null | undefined
): { code: string; automation: JournalAutomation }[] {
  const map = parseJournalAutomationJson(org?.journalAutomationJson);
  const codes = new Set<string>([
    ...Object.keys(map),
    ...toStringArray(org?.autoJournalCodes),
  ]);
  return [...codes]
    .sort()
    .map((code) => ({ code, automation: getJournalAutomation(org, code) }))
    .filter((row) => row.automation.autoCreate || row.automation.autoFill);
}

/**
 * Коды, которые ежедневный cron автоматизации обслуживает ПОЛНОСТЬЮ.
 * Старые cron'ы (04:00 auto-create, 05:00 auto-fill) их пропускают,
 * чтобы не делать ту же работу дважды и не путать логи.
 */
export function listAutomationOwnedCodes(
  org: JournalAutomationOrg | null | undefined
): string[] {
  const map = parseJournalAutomationJson(org?.journalAutomationJson);
  return Object.entries(map)
    .filter(([, value]) => value.autoCreate && value.autoFill)
    .map(([code]) => code)
    .sort();
}

/** Буллеты модалки включения — они же в tooltip и в PageGuide журнала. */
export const AUTOMATION_ENABLE_BULLETS = [
  "Каждый день в 06:00 сайт создаст журнал на текущий период, если его нет, и добавит всех сотрудников, у кого не выходной.",
  "Каждому проставит «Здоров» и «температура ниже 37».",
  "Выходные, отпуска и больничные отметятся сами («В», «Отп», «Б/л»).",
  "Если у сотрудника температура, болезнь или отстранение — изменения вносятся день в день. Прошлые дни редактировать нельзя.",
] as const;

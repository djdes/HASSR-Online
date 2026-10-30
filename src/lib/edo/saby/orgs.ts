// Организации для Saby: как описать сторону документа (ООО — ИНН+КПП+название, ИП — ИНН+ФИО),
// разобрать список своих организаций кабинета и найти в нём наше юр. лицо (ООО «БФС»).
// Перенесено из DocsFlow (`src/lib/edo/saby/orgs.ts`). Файл чистый: тесты идут без БД.

/** Организация в виде, в котором Saby принимает её в документе. */
export type OrgRef =
  | { kind: "ul"; inn: string; kpp: string; name: string }
  | { kind: "ip"; inn: string; lastName: string; firstName: string; middleName: string; name: string };

/** Своя организация из кабинета Saby. */
export interface SabyOrg {
  inn: string;
  kpp: string;
  name: string;
  /** Электронный документооборот в кабинете для неё подключён. */
  edoEnabled: boolean;
}

/** Данные не позволяют собрать запрос к Saby (то, что человек может исправить сам). */
export class EdoInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdoInputError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Значение из ответа Saby строкой (ИНН и КПП приходят и числом, и строкой). */
function text(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** ИНН из 12 цифр — индивидуальный предприниматель (или физлицо), из 10 — юр. лицо. */
export function isIpInn(inn: string): boolean {
  return /^\d{12}$/.test(inn.trim());
}

// ---------------------------------------------------------------------------------------------
// Сторона документа → OrgRef
// ---------------------------------------------------------------------------------------------

const IP_PREFIX = /^\s*(?:индивидуальный\s+предприниматель|ип)\s+/i;

/**
 * Полное ФИО из строки: после отсечения префикса «Индивидуальный предприниматель» / «ИП» —
 * два или три слова без точек (с точкой — это инициалы, а не ФИО). `needPrefix` — строка названия
 * организации: ФИО в ней считаем только после префикса, иначе «Кофейня Уют» примется за фамилию и имя.
 */
function parseFullName(raw: string, needPrefix: boolean): { lastName: string; firstName: string; middleName: string } | null {
  if (needPrefix && !IP_PREFIX.test(raw)) return null;
  const words = raw.replace(IP_PREFIX, "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 3) return null;
  if (words.some((w) => w.includes("."))) return null;
  const [lastName, firstName, middleName = ""] = words;
  return { lastName, firstName, middleName };
}

/**
 * Сторона → описание для Saby. ООО — по ИНН и КПП. ИП Saby ищет по ФИО: берём из полного названия,
 * затем из руководителя (у ИП это он сам), затем из короткого названия; одни инициалы — EdoInputError.
 */
export function entityOrgRef(e: {
  inn: string;
  kpp: string;
  isIp: boolean;
  fullName: string;
  shortName: string;
  director: string;
}): OrgRef {
  const inn = e.inn.trim();
  const name = e.fullName.trim() || e.shortName.trim();
  if (!/^\d{10}$|^\d{12}$/.test(inn)) {
    throw new EdoInputError(`У «${name || "организации"}» нет корректного ИНН — заполните реквизиты организации`);
  }
  if (!e.isIp) return { kind: "ul", inn, kpp: e.kpp.trim(), name };

  const candidates: Array<[string, boolean]> = [
    [e.fullName, true],
    [e.director, false],
    [e.shortName, true],
  ];
  for (const [candidate, needPrefix] of candidates) {
    const fio = parseFullName(candidate, needPrefix);
    if (fio) return { kind: "ip", inn, ...fio, name };
  }
  throw new EdoInputError(
    `ИП «${e.shortName.trim() || e.fullName.trim()}»: нужно полное ФИО предпринимателя (фамилия, имя, отчество) — Saby ищет ИП по ФИО. Обновите реквизиты организации из ЕГРИП`,
  );
}

// ---------------------------------------------------------------------------------------------
// Ответ «СБИС.СписокНашихОрганизаций» → SabyOrg[]
// ---------------------------------------------------------------------------------------------

/** «Да» / true — флаг поднят. Saby отдаёт и строку, и булево. */
function isYes(v: unknown): boolean {
  if (v === true) return true;
  return typeof v === "string" && /^(?:да|true|1)$/i.test(v.trim());
}

function parseOrg(item: unknown): SabyOrg | null {
  if (!isRecord(item)) return null;
  const ul = isRecord(item["СвЮЛ"]) ? item["СвЮЛ"] : null;
  const fl = isRecord(item["СвФЛ"]) ? item["СвФЛ"] : null;
  const src = ul ?? fl ?? item;

  const inn = text(src["ИНН"]);
  if (!inn) return null;

  const name = fl
    ? text(fl["НазваниеПолное"]) || [text(fl["Фамилия"]), text(fl["Имя"]), text(fl["Отчество"])].filter(Boolean).join(" ")
    : text(src["Название"]) || text(src["Наименование"]);

  return {
    inn,
    kpp: text(src["КПП"]),
    name,
    edoEnabled: isYes(item["ДокументооборотПодключен"]) || isYes(src["ДокументооборотПодключен"]),
  };
}

/**
 * Защитный разбор (живой ответ 23.10.2026: `result.НашаОрганизация[]` с `СвЮЛ`/`СвФЛ` и
 * `ДокументооборотПодключен: "Да"|"Нет"`). Единственный объект вместо массива тоже принимается.
 */
export function parseOurOrgs(raw: unknown): SabyOrg[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (isRecord(raw)) {
    const inner = raw["НашаОрганизация"] ?? raw["Организация"];
    if (Array.isArray(inner)) list = inner;
    else if (inner !== undefined && inner !== null) list = [inner];
  }
  return list.map(parseOrg).filter((o): o is SabyOrg => o !== null);
}

/** Кэш организаций из БД (уже разобранный `SabyOrg[]`): мусор пропускается, ничего не бросается. */
export function parseCachedOrgs(data: unknown): SabyOrg[] {
  if (!Array.isArray(data)) return [];
  const out: SabyOrg[] = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const { inn, kpp, name, edoEnabled } = item;
    if (typeof inn !== "string" || !inn) continue;
    if (typeof kpp !== "string" || typeof name !== "string" || typeof edoEnabled !== "boolean") continue;
    out.push({ inn, kpp, name, edoEnabled });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Наше юр. лицо в кабинете
// ---------------------------------------------------------------------------------------------

/**
 * Где наше юр. лицо в кабинете: `ready` — ровно одна организация с ЭДО; `edo_off` — есть, но ЭДО
 * для неё не подключён; `missing` — такой организации в кабинете нет; `ambiguous` — несколько
 * подходящих с ЭДО (одинаковый ИНН, разные КПП/филиалы) — молча выбирать нельзя.
 */
export type OurOrgMatch =
  | { kind: "ready"; org: SabyOrg }
  | { kind: "edo_off"; org: SabyOrg }
  | { kind: "missing" }
  | { kind: "ambiguous"; orgs: SabyOrg[] };

/** ИНН совпадает; КПП сверяем, когда он заполнен с обеих сторон (у ИП его нет). */
function sameOrg(o: SabyOrg, inn: string, kpp: string): boolean {
  return o.inn === inn && (!kpp || !o.kpp || o.kpp === kpp);
}

export function matchOurOrg(orgs: SabyOrg[], inn: string, kpp: string): OurOrgMatch {
  const innT = inn.trim();
  const kppT = kpp.trim();
  if (!innT) return { kind: "missing" };
  const same = orgs.filter((o) => sameOrg(o, innT, kppT));
  const withEdo = same.filter((o) => o.edoEnabled);
  if (withEdo.length === 1) return { kind: "ready", org: withEdo[0] };
  if (withEdo.length > 1) return { kind: "ambiguous", orgs: withEdo };
  if (same.length > 0) return { kind: "edo_off", org: same[0] };
  return { kind: "missing" };
}

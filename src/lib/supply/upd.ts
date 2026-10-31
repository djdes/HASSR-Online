import { XMLParser } from "fast-xml-parser";

/**
 * Разбор УПД — универсального передаточного документа в формате ФНС
 * (`ON_NSCHFDOPPR…`, версии 5.01–5.03; функции СЧФДОП, ДОП, СЧФ). Так приходят
 * накладные поставщиков в Диадок, СБИС и любой другой оператор ЭДО.
 *
 * Берём только то, что нужно приёмке: номер и дату, продавца, строки
 * (что, сколько, в каких единицах, почём) и «годен до», если поставщик его
 * передал в доп. сведениях строки. Чистый модуль: файл → данные, без БД.
 */

export type SupplyParty = {
  name: string;
  inn: string | null;
  kpp: string | null;
};

export type SupplyItem = {
  line: number;
  name: string;
  /** «кг», «шт», «л» — из документа или по коду ОКЕИ. */
  unit: string | null;
  quantity: number | null;
  price: number | null;
  /** Стоимость с налогом (или без, если с налогом нет). */
  amount: number | null;
  /** Код товара у поставщика. */
  code: string | null;
  /** «Годен до», YYYY-MM-DD, если поставщик передал. */
  expiryDate: string | null;
};

export type ParsedUpd = {
  /** upd — УПД из ЭДО; invoice — приходная накладная из учётной системы (iiko). */
  kind: "upd" | "invoice";
  /** СЧФДОП, ДОП, СЧФ… */
  function: string;
  formatVersion: string | null;
  number: string;
  /** YYYY-MM-DD */
  date: string;
  seller: SupplyParty;
  buyer: SupplyParty | null;
  /** Грузополучатель (`ГрузПолуч`) — по его КПП находится точка доставки. */
  consignee?: SupplyParty | null;
  items: SupplyItem[];
  total: number | null;
  /** «Договор № 12 от 01.01.2026» — основание передачи. */
  basis: string | null;
  /** Дата отгрузки (передачи), YYYY-MM-DD. */
  shippedDate: string | null;
};

export class UpdParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdParseError";
  }
}

/** Самые частые коды ОКЕИ в накладных на продукты. */
const OKEI: Record<string, string> = {
  "006": "м",
  "055": "м²",
  "111": "мл",
  "112": "л",
  "113": "м³",
  "163": "г",
  "166": "кг",
  "168": "т",
  "625": "лист",
  "704": "набор",
  "715": "пар",
  "736": "рул",
  "778": "упак",
  "796": "шт",
  "798": "тыс. шт",
  "868": "бут",
  "872": "флак",
  "876": "усл. ед.",
};

/** Строки «годен до» в доп. сведениях: идентификаторы у поставщиков разные. */
const EXPIRY_ID = /год|срок|expir|shelf|best/i;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: true,
  isArray: (name) => name === "СведТов" || name === "ИнфПолФХЖ2" || name === "ОснПер" || name === "СвПрод",
});

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && !Array.isArray(value);

function first(value: unknown): Node | null {
  if (Array.isArray(value)) return isNode(value[0]) ? value[0] : null;
  return isNode(value) ? value : null;
}

function attr(node: Node | null, name: string): string | null {
  const value = node?.[`@${name}`];
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

/** Кодировка из пролога: УПД почти всегда в windows-1251. */
export function decodeXml(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const encoding = /encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1]?.toLowerCase() ?? "utf-8";
  const label = encoding === "cp1251" ? "windows-1251" : encoding;
  try {
    return new TextDecoder(label).decode(bytes).replace(/^﻿/, "");
  } catch {
    throw new UpdParseError(`Кодировка файла «${encoding}» не поддерживается`);
  }
}

/** «31.10.2026» → «2026-10-31»; ISO оставляем как есть; иначе null. */
export function parseRuDate(value: string | null): string | null {
  if (!value) return null;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

export function parseAmount(value: string | null): number | null {
  if (!value) return null;
  const number = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function party(node: Node | null): SupplyParty | null {
  const id = first(node?.["ИдСв"]);
  if (!id) return null;
  const company = first(id["СвЮЛУч"]) ?? first(id["СвИнНеУч"]);
  if (company) {
    const name = attr(company, "НаимОрг");
    return name ? { name, inn: attr(company, "ИННЮЛ") ?? attr(company, "ИдСтат"), kpp: attr(company, "КПП") } : null;
  }
  const person = first(id["СвИП"]) ?? first(id["СвФЛУч"]);
  if (person) {
    const fio = first(person["ФИО"]);
    const parts = [attr(fio, "Фамилия"), attr(fio, "Имя"), attr(fio, "Отчество")].filter(Boolean);
    if (parts.length === 0) return null;
    return { name: `ИП ${parts.join(" ")}`, inn: attr(person, "ИННФЛ"), kpp: null };
  }
  return null;
}

function itemExpiry(item: Node): string | null {
  const extras = Array.isArray(item["ИнфПолФХЖ2"]) ? (item["ИнфПолФХЖ2"] as unknown[]) : [];
  for (const raw of extras) {
    const extra = isNode(raw) ? raw : null;
    const id = attr(extra, "Идентиф") ?? "";
    if (!EXPIRY_ID.test(id)) continue;
    const date = parseRuDate(attr(extra, "Значен"));
    if (date) return date;
  }
  return null;
}

function parseItem(raw: unknown, index: number): SupplyItem | null {
  const item = isNode(raw) ? raw : null;
  if (!item) return null;
  const name = attr(item, "НаимТов");
  if (!name) return null;
  const extra = first(item["ДопСведТов"]);
  const okei = attr(item, "ОКЕИ_Тов");
  const quantity = parseAmount(attr(item, "КолТов"));
  return {
    line: Number(attr(item, "НомСтр")) || index + 1,
    name,
    unit: attr(item, "НаимЕдИзм") ?? attr(extra, "НаимЕдИзм") ?? (okei ? (OKEI[okei.padStart(3, "0")] ?? null) : null),
    quantity,
    price: parseAmount(attr(item, "ЦенаТов")),
    amount: parseAmount(attr(item, "СтТовУчНал")) ?? parseAmount(attr(item, "СтТовБезНДС")),
    code: attr(extra, "КодТов") ?? attr(item, "КодТов"),
    expiryDate: itemExpiry(item),
  };
}

function basisOf(document: Node): { basis: string | null; shippedDate: string | null } {
  const transfer = first(first(document["СвПродПер"])?.["СвПер"]);
  if (!transfer) return { basis: null, shippedDate: null };
  const reasons = Array.isArray(transfer["ОснПер"]) ? (transfer["ОснПер"] as unknown[]) : [];
  const reason = isNode(reasons[0]) ? reasons[0] : null;
  const title = attr(reason, "НаимОсн");
  const number = attr(reason, "НомОсн");
  const date = attr(reason, "ДатаОсн");
  const basis = title && title.toLowerCase() !== "без документа-основания"
    ? [title, number ? `№ ${number}` : null, date ? `от ${date}` : null].filter(Boolean).join(" ")
    : null;
  return { basis, shippedDate: parseRuDate(attr(transfer, "ДатаПер")) };
}

/**
 * УПД из файла. Ошибка — {@link UpdParseError} с причиной, понятной человеку:
 * «это не УПД», «нет номера» и т. п.
 */
export function parseUpd(input: Uint8Array | string): ParsedUpd {
  const xml = typeof input === "string" ? input : decodeXml(input);
  let parsed: unknown;
  try {
    parsed = parser.parse(xml, true);
  } catch (error) {
    throw new UpdParseError(`Файл не похож на XML: ${error instanceof Error ? error.message.split("\n")[0] : "ошибка разбора"}`);
  }
  const root = isNode(parsed) ? first(parsed["Файл"]) : null;
  const document = first(root?.["Документ"]);
  const invoice = first(document?.["СвСчФакт"]);
  if (!root || !document || !invoice) {
    throw new UpdParseError("Это не УПД: в файле нет счёта-фактуры или передаточного документа в формате ФНС");
  }
  const number = attr(invoice, "НомерСчФ") ?? attr(invoice, "НомерДок");
  const date = parseRuDate(attr(invoice, "ДатаСчФ") ?? attr(invoice, "ДатаДок"));
  if (!number || !date) throw new UpdParseError("В УПД нет номера или даты документа");
  const seller = party(first(invoice["СвПрод"]));
  if (!seller) throw new UpdParseError("В УПД нет продавца");

  const table = first(document["ТаблСчФакт"]);
  const rows = Array.isArray(table?.["СведТов"]) ? (table["СведТов"] as unknown[]) : [];
  const items = rows.map(parseItem).filter((item): item is SupplyItem => item !== null);
  if (items.length === 0) throw new UpdParseError("В УПД нет строк с товарами");
  const totals = first(table?.["ВсегоОпл"]);

  return {
    kind: "upd",
    function: attr(document, "Функция") ?? "",
    formatVersion: attr(root, "ВерсФорм"),
    number,
    date,
    seller,
    buyer: party(first(invoice["СвПокуп"])),
    consignee: party(first(invoice["ГрузПолуч"])),
    items,
    total: parseAmount(attr(totals, "СтТовУчНалВсего")) ?? parseAmount(attr(totals, "СтТовБезНДСВсего")),
    ...basisOf(document),
  };
}

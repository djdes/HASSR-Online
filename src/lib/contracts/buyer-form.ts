/**
 * Реквизиты клиента и текст договора в форме карточки ROOT — чистые
 * функции: их зовут сервер (снимок выпуска), клиентская карточка (чек-лист
 * по тому, что сейчас в форме) и тесты.
 *
 * Правки реквизитов живут только в снимке договора: данные организации
 * («Реквизиты», ЕГРЮЛ) они не меняют.
 */

import { isValidInn } from "@/lib/inn";

import { clean, isIndividualInn } from "./format";
import { individualName } from "./template";
import type { ContractBuyer, ContractChecklistItem, ContractCustomSection, ContractParams } from "./types";

/** Поля блока «Реквизиты клиента». Пустое — в договоре линия (или строки нет, если она необязательна). */
export type ContractBuyerInput = {
  nameFull: string | null;
  nameShort: string | null;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  legalAddress: string | null;
  actualAddress: string | null;
  phone: string | null;
  bankName: string | null;
  bankBik: string | null;
  bankAccount: string | null;
  bankCorrAccount: string | null;
};

export const BUYER_INPUT_KEYS = [
  "nameFull",
  "nameShort",
  "inn",
  "kpp",
  "ogrn",
  "legalAddress",
  "actualAddress",
  "phone",
  "bankName",
  "bankBik",
  "bankAccount",
  "bankCorrAccount",
] as const satisfies ReadonlyArray<keyof ContractBuyerInput>;

const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

export function buyerInputFrom(buyer: ContractBuyer): ContractBuyerInput {
  return {
    nameFull: buyer.nameFull || null,
    nameShort: buyer.nameShort && buyer.nameShort !== buyer.nameFull ? buyer.nameShort : null,
    inn: buyer.inn,
    kpp: buyer.kpp,
    ogrn: buyer.ogrn,
    legalAddress: buyer.legalAddress,
    actualAddress: buyer.actualAddress,
    phone: buyer.phone,
    bankName: buyer.bank?.name ?? null,
    bankBik: buyer.bank?.bik ?? null,
    bankAccount: buyer.bank?.account ?? null,
    bankCorrAccount: buyer.bank?.corrAccount ?? null,
  };
}

/** ИП или юрлицо по ИНН из формы: 12 цифр — ИП, 10 — юрлицо; иначе как у организации. */
export function buyerKindFromInput(inn: string | null | undefined, fallback: ContractBuyer["kind"]): ContractBuyer["kind"] {
  const value = digits(inn);
  if (value.length === 10) return "legal";
  if (isIndividualInn(value)) return "individual";
  return fallback;
}

/** Заказчик для снимка: всё из формы (пустое — null), тип лица — по ИНН. */
export function applyBuyerInput(base: ContractBuyer, input: ContractBuyerInput, email: string | null): ContractBuyer {
  const kind = buyerKindFromInput(input.inn, base.kind);
  const inn = clean(input.inn);
  const nameFull = clean(input.nameFull) ?? "";
  const bank = {
    name: clean(input.bankName),
    bik: clean(input.bankBik),
    account: clean(input.bankAccount),
    corrAccount: clean(input.bankCorrAccount),
  };
  return {
    kind,
    nameFull,
    nameShort: clean(input.nameShort) ?? nameFull,
    inn: inn ? digits(inn) || inn : null,
    kpp: kind === "individual" ? null : clean(input.kpp),
    ogrn: clean(input.ogrn),
    legalAddress: clean(input.legalAddress),
    actualAddress: clean(input.actualAddress) && clean(input.actualAddress) !== clean(input.legalAddress) ? clean(input.actualAddress) : null,
    phone: clean(input.phone),
    email,
    bank: Object.values(bank).some(Boolean) ? bank : null,
  };
}

/**
 * Чек-лист клиента. Обязателен только ИНН: без него сторона договора не
 * определена. Остальное — предупреждения: в договоре будет линия для
 * ручного заполнения.
 */
export function buyerChecklist(buyer: ContractBuyer, params: ContractParams, registeredName: boolean): ContractChecklistItem[] {
  const items: ContractChecklistItem[] = [
    { key: "inn", label: "ИНН", ok: Boolean(buyer.inn && isValidInn(buyer.inn)), required: true },
    { key: "nameFull", label: "Полное наименование по ЕГРЮЛ", ok: registeredName, required: false },
    { key: "ogrn", label: buyer.kind === "individual" ? "ОГРНИП" : "ОГРН", ok: Boolean(buyer.ogrn && /^\d{13}(\d{2})?$/.test(buyer.ogrn)), required: false },
    { key: "legalAddress", label: buyer.kind === "individual" ? "Адрес" : "Юридический адрес", ok: Boolean(buyer.legalAddress), required: false },
  ];
  if (buyer.kind === "legal") {
    items.push(
      { key: "kpp", label: "КПП", ok: Boolean(buyer.kpp && /^\d{9}$/.test(buyer.kpp)), required: false },
      { key: "signer", label: "Руководитель (должность и ФИО)", ok: Boolean(clean(params.signerName) && clean(params.signerPost)), required: false },
      { key: "basis", label: "Основание полномочий", ok: Boolean(clean(params.signerBasis)), required: false },
    );
  } else {
    items.push({ key: "signer", label: "ФИО предпринимателя", ok: Boolean(individualName(buyer) ?? clean(params.signerName)), required: false });
  }
  items.push({ key: "email", label: "Почта для уведомлений", ok: Boolean(buyer.email), required: false });
  return items;
}

// ───────────── текст договора в редакторе: раздел ↔ textarea ─────────────

const ITEM_RE = /^([а-яёa-z]\)|[-–—•])\s+(.+)$/i;

/** Пункты раздела → текст для textarea: пункт на строку, подпункт — «а) …». */
export function blocksToText(blocks: ContractCustomSection["blocks"]): string {
  return blocks.map((block) => (Array.isArray(block) ? `${block[0]} ${block[1]}` : block)).join("\n");
}

/** Текст из textarea → пункты: строка — пункт, «а) …» — подпункт; пустые строки пропускаем. */
export function textToBlocks(text: string): ContractCustomSection["blocks"] {
  const blocks: ContractCustomSection["blocks"] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const item = ITEM_RE.exec(line);
    blocks.push(item ? [item[1], item[2]] : line);
  }
  return blocks;
}

/** Разделы из редактора: без пустых, заголовок обязателен (иначе «Раздел N»). */
export function cleanCustomSections(sections: ReadonlyArray<{ title: string; text: string }>): ContractCustomSection[] {
  return sections
    .map((section, index) => ({ title: clean(section.title) ?? `Раздел ${index + 1}`, blocks: textToBlocks(section.text) }))
    .filter((section) => section.blocks.length > 0);
}

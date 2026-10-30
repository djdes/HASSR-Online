/**
 * Снимки сторон договора и чек-листы готовности — чистые функции.
 *
 * Исполнитель — `PlatformRequisites` (ROOT → «Реквизиты и подпись»).
 * Заказчик — та же сборка, что во всех документах организации
 * (`buildDocumentOrgBlock`: правки «Реквизитов» поверх снимка ЕГРЮЛ),
 * плюс тип лица (ИП / юрлицо) из снимка или длины ИНН.
 */

import { formatPhone } from "@/lib/brand-docs/phone";
import type { PlatformRequisites } from "@/lib/closing-documents/types";
import {
  buildDocumentOrgBlock,
  cityFromAddress,
  currentLegalProfile,
  readLegalOverrides,
  registryDefaults,
  type DocumentOrgSource,
} from "@/lib/document-org-block";
import { isValidInn } from "@/lib/inn";

import { clean, isIndividualInn, personName, postInSentence } from "./format";
import { individualName } from "./template";
import type { ContractBuyer, ContractChecklistItem, ContractParams, ContractSeller } from "./types";

export const SELLER_SITE = "wesetup.ru";

export function sellerFromRequisites(r: PlatformRequisites): ContractSeller {
  return {
    nameFull: r.nameFull.trim(),
    nameShort: r.nameShort.trim(),
    inn: r.inn.trim(),
    kpp: r.kpp.trim(),
    ogrn: r.ogrn.trim(),
    address: r.address.trim(),
    bank: {
      name: r.bank.name.trim(),
      bik: r.bank.bik.trim(),
      account: r.bank.account.trim(),
      corrAccount: r.bank.corrAccount.trim(),
    },
    head: { post: r.head.post.trim(), name: r.head.name.trim() },
    vatMode: "none",
    email: r.email.trim(),
    phone: formatPhone(r.phone),
    site: SELLER_SITE,
  };
}

const digits = (value: string, lengths: number[]) => /^\d+$/.test(value.trim()) && lengths.includes(value.trim().length);

/**
 * Готовность реквизитов БФС. Без обязательных полей договор не выпускается:
 * пустой ИНН или счёт Исполнителя в договоре хуже, чем отказ. Факсимиле и
 * печать — по желанию (без них договор подписывают вручную).
 */
export function sellerChecklist(seller: ContractSeller, images: { facsimile: boolean; stamp: boolean }): ContractChecklistItem[] {
  return [
    { key: "nameFull", label: "Полное наименование", ok: seller.nameFull.length > 3, required: true },
    { key: "inn", label: "ИНН", ok: digits(seller.inn, [10, 12]), required: true },
    { key: "ogrn", label: "ОГРН", ok: digits(seller.ogrn, [13, 15]), required: true },
    { key: "address", label: "Юридический адрес", ok: seller.address.length > 10, required: true },
    {
      key: "bank",
      label: "Банк, БИК, расчётный и корр. счёт",
      ok:
        seller.bank.name.length > 2 &&
        digits(seller.bank.bik, [9]) &&
        digits(seller.bank.account, [20]) &&
        digits(seller.bank.corrAccount, [20]),
      required: true,
    },
    { key: "head", label: "Руководитель (должность и ФИО)", ok: seller.head.post.length > 2 && seller.head.name.length > 4, required: true },
    { key: "facsimile", label: "Факсимиле подписи", ok: images.facsimile, required: false },
    { key: "stamp", label: "Печать", ok: images.stamp, required: false },
  ];
}

/** Источник для заказчика: поля организации, из которых собирается блок документов. */
export type BuyerSource = DocumentOrgSource;

export function buyerKind(source: Pick<BuyerSource, "inn" | "legalProfileJson">): "legal" | "individual" {
  const profile = currentLegalProfile(source);
  if (profile?.type === "INDIVIDUAL") return "individual";
  if (profile?.type === "LEGAL") return "legal";
  return isIndividualInn(source.inn) ? "individual" : "legal";
}

export function buyerFromOrganization(source: BuyerSource, email: string | null): ContractBuyer {
  const block = buildDocumentOrgBlock({ org: source });
  const kind = buyerKind(source);
  const own = readLegalOverrides(source);
  const registry = registryDefaults(source);
  const profile = currentLegalProfile(source);
  // Полное наименование только из ЕГРЮЛ или «Реквизитов»; иначе — то, что
  // есть (название в сервисе), а чек-лист предупредит.
  const registered = own.legalFullName ?? registry.legalFullName;
  const nameFull = registered ?? block.org.fullName;
  const nameShort = clean(profile?.nameShort) ?? block.org.shortName;
  return {
    kind,
    nameFull,
    nameShort,
    inn: clean(block.org.inn),
    kpp: kind === "individual" ? null : clean(block.org.kpp),
    ogrn: clean(block.org.ogrn),
    legalAddress: clean(block.org.legalAddress),
    actualAddress: block.org.address && block.org.address !== block.org.legalAddress ? clean(block.org.address) : null,
    phone: clean(block.org.phone),
    email: clean(email),
  };
}

/** Есть ли у клиента наименование из ЕГРЮЛ или «Реквизитов» (а не только название в сервисе). */
export function hasRegisteredName(source: BuyerSource): boolean {
  const own = readLegalOverrides(source);
  const registry = registryDefaults(source);
  return Boolean(own.legalFullName ?? registry.legalFullName);
}

/** Подписант по умолчанию: руководитель из ЕГРЮЛ / «Реквизитов»; у ИП — сам предприниматель. */
export function defaultContractParams(source: BuyerSource, buyer: ContractBuyer): ContractParams {
  const block = buildDocumentOrgBlock({ org: source });
  if (buyer.kind === "individual") {
    return {
      signerName: individualName(buyer) ?? personName(block.org.directorName),
      signerPost: null,
      signerBasis: null,
      useFacsimile: true,
    };
  }
  return {
    signerName: personName(block.org.directorName),
    signerPost: postInSentence(block.org.directorPost),
    signerBasis: "Устава",
    useFacsimile: true,
  };
}

/** Город договора — по юридическому адресу Исполнителя. */
export function defaultContractCity(seller: ContractSeller): string {
  return cityFromAddress(seller.address) ?? "";
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

export function checklistBlocks(items: readonly ContractChecklistItem[]): string[] {
  return items.filter((item) => item.required && !item.ok).map((item) => item.label);
}

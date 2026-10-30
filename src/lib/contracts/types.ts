/**
 * Договор оказания услуг с клиентом (ROOT → организация) — типы снимков.
 *
 * Договор выпускается один раз и дальше всегда перерисовывается из
 * снимков `ClientContract.seller` / `buyer` / `params`: реквизиты ООО «БФС»
 * или клиента могут поменяться, а подписанный текст — нет.
 *
 * Модуль чистый: его зовут сервер, PDF/DOCX-рендеры, клиентская карточка
 * ROOT и `node --test`.
 */

export type ContractStatus = "issued" | "sent" | "voided";

/** Исполнитель — ООО «БФС», снимок `PlatformSetting` `legal.requisites`. */
export type ContractSeller = {
  nameFull: string;
  nameShort: string;
  inn: string;
  kpp: string;
  ogrn: string;
  address: string;
  bank: { name: string; bik: string; account: string; corrAccount: string };
  head: { post: string; name: string };
  /** УСН без НДС — сейчас единственный режим. */
  vatMode: "none";
  email: string;
  phone: string;
  site: string;
};

/** Заказчик — организация-клиент: ИНН, снимок ЕГРЮЛ и правки «Реквизитов». */
export type ContractBuyer = {
  /** «legal» — юрлицо, «individual» — ИП (ИНН из 12 цифр или тип INDIVIDUAL). */
  kind: "legal" | "individual";
  nameFull: string;
  nameShort: string;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  legalAddress: string | null;
  /** Фактический адрес, если отличается от юридического. */
  actualAddress: string | null;
  phone: string | null;
  /** Почта для уведомлений по договору (разд. 12). */
  email: string | null;
};

/** Параметры выпуска — то, что ROOT задаёт в форме. */
export type ContractParams = {
  /** ФИО подписанта Заказчика (у ИП — сам предприниматель). */
  signerName: string | null;
  /** Должность подписанта: «генеральный директор». У ИП не используется. */
  signerPost: string | null;
  /** Основание полномочий в родительном падеже: «Устава», «доверенности № 5 от 01.10.2026». */
  signerBasis: string | null;
  /** Ставить факсимиле подписи и печать Исполнителя (если загружены). */
  useFacsimile: boolean;
};

export type ContractSnapshot = {
  number: string;
  /** Дата договора, YYYY-MM-DD. */
  date: string;
  city: string;
  templateVersion: string;
  seller: ContractSeller;
  buyer: ContractBuyer;
  params: ContractParams;
};

export type ContractChecklistItem = {
  key: string;
  label: string;
  ok: boolean;
  /** Без поля договор не выпускается; иначе — линия для ручного заполнения. */
  required: boolean;
};

/** Почта-кандидат в получатели письма и откуда она взялась. */
export type ContractRecipientSource = "owner" | "ownerContact" | "accountant" | "registry" | "manual";

export type ContractRecipient = { email: string; source: ContractRecipientSource };

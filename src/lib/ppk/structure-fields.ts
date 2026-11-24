/**
 * Поля пунктов 1.1 «Общая информация об организации» и 1.4 «Общая информация
 * о производстве» структуры ППК: какие обязательны для корректного ППК и чего
 * не хватает. Не хватает — окно предупреждает «Ваши документы могут быть
 * заполнены не полностью», сохранить с пропуском можно после подтверждения.
 * Чистый модуль без БД и React.
 */
import type { DocumentOrgBlock } from "@/lib/document-org-block";
import type { ProductionInfoData } from "./records";

/** Поля сведений об организации в окне 1.1 (те же, что «Моя компания → Реквизиты»). */
export const ORG_INFO_FIELDS = [
  "legalFullName",
  "inn",
  "kpp",
  "ogrn",
  "legalAddress",
  "address",
  "phone",
  "directorName",
  "directorPost",
] as const;
export type OrgInfoField = (typeof ORG_INFO_FIELDS)[number];

/** ИП: ОГРНИП или ИНН из 12 цифр — у него нет КПП. */
export function isIndividualOrg(org: Pick<DocumentOrgBlock["org"], "ogrnLabel" | "inn">): boolean {
  return org.ogrnLabel === "ОГРНИП" || (org.inn ?? "").replace(/\D/g, "").length === 12;
}

/** Обязательные поля 1.1 для этой организации (у ИП без КПП). */
export function requiredOrgInfo(org: Pick<DocumentOrgBlock["org"], "ogrnLabel" | "inn">): OrgInfoField[] {
  return ORG_INFO_FIELDS.filter((field) => field !== "kpp" || !isIndividualOrg(org));
}

const filled = (value: string | null | undefined) => Boolean(value && value.trim());

/** Каких обязательных сведений об организации нет в действующем блоке реквизитов. */
export function missingOrgInfo(org: DocumentOrgBlock["org"]): OrgInfoField[] {
  const value: Record<OrgInfoField, string | null> = {
    legalFullName: org.fullName,
    inn: org.inn,
    kpp: org.kpp,
    ogrn: org.ogrn,
    legalAddress: org.legalAddress,
    address: org.address,
    phone: org.phone,
    directorName: org.directorName,
    directorPost: org.directorPost,
  };
  return requiredOrgInfo(org).filter((field) => !filled(value[field]));
}

export type ProductionInfoField = keyof ProductionInfoData;

/** Поля шаблона 1.4 в порядке окна: обязательные для ППК помечены. */
export const PRODUCTION_INFO_FIELDS: readonly { key: ProductionInfoField; required: boolean; multiline?: boolean; max: number }[] = [
  { key: "activity", required: false, max: 300 },
  { key: "workingHours", required: true, max: 200 },
  { key: "seats", required: false, max: 100 },
  { key: "capacity", required: true, max: 200 },
  { key: "area", required: false, max: 100 },
  { key: "waterSupply", required: true, max: 300 },
  { key: "sewage", required: true, max: 300 },
  { key: "ventilation", required: false, max: 300 },
  { key: "heating", required: false, max: 300 },
  { key: "serviceForm", required: false, max: 300 },
  { key: "extra", required: false, multiline: true, max: 4000 },
];

export function emptyProductionInfo(): ProductionInfoData {
  return Object.fromEntries(PRODUCTION_INFO_FIELDS.map((field) => [field.key, ""])) as ProductionInfoData;
}

/** Сведения, которые 1.4 подтягивает из объекта (меняются в «Объектах»). */
export type ProductionPulled = { objectName: string | null; objectAddress: string | null; activity: string | null };

export type ProductionMissing = ProductionInfoField | "objectName" | "objectAddress";

/** Чего не хватает в сведениях о производстве: подтянутое из объекта и обязательные поля шаблона. */
export function missingProductionInfo(data: ProductionInfoData | null, pulled: ProductionPulled): ProductionMissing[] {
  const missing: ProductionMissing[] = [];
  if (!filled(pulled.objectName)) missing.push("objectName");
  if (!filled(pulled.objectAddress)) missing.push("objectAddress");
  for (const field of PRODUCTION_INFO_FIELDS) {
    if (!field.required) continue;
    const own = data?.[field.key];
    if (filled(own)) continue;
    missing.push(field.key);
  }
  return missing;
}

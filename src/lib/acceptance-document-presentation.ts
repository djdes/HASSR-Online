import type { AcceptanceDocumentConfig, AcceptanceRow } from "@/lib/acceptance-document";
import { humanizeFetchError, NO_CONNECTION_MESSAGE } from "@/lib/humanize-fetch-error";
import { orgDisplayName } from "@/lib/org-display-name";
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";
import { readHeaderOrgNameOverride, sanitizeOrgJournalName, suggestOrgJournalName, type OrgJournalNameSource } from "@/lib/org-journal-name";

/** Prove a generated organization fallback from its sources, never by comparing customer prose. */
export function captureAcceptanceOrganizationFallbackSuffix(
  renderedName: string,
  organization: OrgJournalNameSource | null | undefined,
  config: unknown,
): string | null {
  if (readHeaderOrgNameOverride(config) || sanitizeOrgJournalName(organization?.journalShortName) || suggestOrgJournalName(organization?.legalProfileJson)) return null;
  const missing = Object.freeze({});
  if (orgDisplayName(organization?.name, missing as unknown as string) !== (missing as unknown as string)) return null;
  return renderedName.startsWith(ORG_NAME_FALLBACK) ? renderedName.slice(ORG_NAME_FALLBACK.length) : null;
}

export type AcceptanceMessageKey =
  "journalAcceptance.list.periodicity"
  | "journalAcceptance.list.periodicityExample"
  | "journalAcceptance.list.required"
  | "journalAcceptance.list.createError"
  | "journalAcceptance.list.deleteDescription"
  | "journalAcceptance.list.rowCount"
  | "journalAcceptance.list.directoryCount"
  | "journalAcceptance.list.started"
  | "journalAcceptance.list.closedHeading"
  | "journalAcceptance.list.shared"
  | "journalAcceptance.list.sharedHint"
  | "journalAcceptance.list.manager"
  | "journalAcceptance.list.expiryColumn"
  | "journalAcceptance.list.addFields"
  | "journalAcceptance.list.createTitle"
  | "journalAcceptance.list.create"
  | "journalAcceptance.list.packagingQuote"
  | "journalControls.guidePage.organizationFallback"
  | "journalWidgets.staff.documentName"
  | "journalWidgets.staff.documentNamePlaceholder"
  | "journalWidgets.staff.responsiblePosition"
  | "journalControls.list.actionsTitle"
  | "journalControls.list.settings"
  | "journalControls.list.print"
  | "journalControls.list.create"
  |
  "common.add"
  | "common.cancel"
  | "common.close"
  | "common.delete"
  | "common.save"
  | "common.saving"
  | "foodControlPdf.acceptance.columns.notes"
  | "foodControlPdf.acceptance.status.nonCompliant"
  | "foodControlPdf.acceptance.status.satisfactory"
  | "foodControlPdf.acceptance.status.unsatisfactory"
  | "foodControlPdf.acceptance.title.rawMaterials"
  | "foodControlPdf.incomingControl.columns.acceptanceDecision"
  | "foodControlPdf.incomingControl.columns.accompanyingDocs"
  | "foodControlPdf.incomingControl.columns.batchInfo"
  | "foodControlPdf.incomingControl.columns.correctiveActions"
  | "foodControlPdf.incomingControl.columns.deliveryDate"
  | "foodControlPdf.incomingControl.columns.documentCompliance"
  | "foodControlPdf.incomingControl.columns.manufacturerSupplier"
  | "foodControlPdf.incomingControl.columns.packagingCompliance"
  | "foodControlPdf.incomingControl.columns.productName"
  | "foodControlPdf.incomingControl.columns.productTemperature"
  | "foodControlPdf.incomingControl.columns.responsible"
  | "foodControlPdf.incomingControl.columns.shelfLifeDate"
  | "foodControlPdf.incomingControl.decision.accept"
  | "foodControlPdf.incomingControl.decision.reject"
  | "foodControlPdf.incomingControl.legacyComplianceSummary"
  | "foodControlPdf.incomingControl.packaging.compliant"
  | "journalAcceptance.actions.adding"
  | "journalAcceptance.actions.openBatch"
  | "journalAcceptance.batch.create"
  | "journalAcceptance.batch.createHint"
  | "journalAcceptance.batch.created"
  | "journalAcceptance.batch.existing"
  | "journalAcceptance.batch.missingCode"
  | "journalAcceptance.bulk.countRange"
  | "journalAcceptance.bulk.emptyCount"
  | "journalAcceptance.bulk.photoHelp"
  | "journalAcceptance.bulk.photoLabel"
  | "journalAcceptance.bulk.photoResult"
  | "journalAcceptance.bulk.title"
  | "journalAcceptance.calendar.heading"
  | "journalAcceptance.calendar.month1"
  | "journalAcceptance.calendar.month10"
  | "journalAcceptance.calendar.month11"
  | "journalAcceptance.calendar.month12"
  | "journalAcceptance.calendar.month2"
  | "journalAcceptance.calendar.month3"
  | "journalAcceptance.calendar.month4"
  | "journalAcceptance.calendar.month5"
  | "journalAcceptance.calendar.month6"
  | "journalAcceptance.calendar.month7"
  | "journalAcceptance.calendar.month8"
  | "journalAcceptance.calendar.month9"
  | "journalAcceptance.calendar.nextMonth"
  | "journalAcceptance.calendar.open"
  | "journalAcceptance.calendar.placeholder"
  | "journalAcceptance.calendar.previousMonth"
  | "journalAcceptance.calendar.weekday1"
  | "journalAcceptance.calendar.weekday2"
  | "journalAcceptance.calendar.weekday3"
  | "journalAcceptance.calendar.weekday4"
  | "journalAcceptance.calendar.weekday5"
  | "journalAcceptance.calendar.weekday6"
  | "journalAcceptance.calendar.weekday7"
  | "journalAcceptance.cards.organolepticLabel"
  | "journalAcceptance.cards.packagingLabel"
  | "journalAcceptance.cards.transportLabel"
  | "journalAcceptance.confirm.closeCount"
  | "journalAcceptance.confirm.closeDescription"
  | "journalAcceptance.confirm.closeLocked"
  | "journalAcceptance.confirm.closeReopen"
  | "journalAcceptance.confirm.closeTitle"
  | "journalAcceptance.confirm.deleteCount"
  | "journalAcceptance.confirm.deleteDescription"
  | "journalAcceptance.confirm.deleteTitle"
  | "journalAcceptance.confirm.products"
  | "journalAcceptance.confirm.productsMissing"
  | "journalAcceptance.confirm.productsMore"
  | "journalAcceptance.confirm.remainingCount"
  | "journalAcceptance.csv.productColumn10"
  | "journalAcceptance.csv.productColumn7"
  | "journalAcceptance.csv.productColumn9"
  | "journalAcceptance.csv.rawColumn1"
  | "journalAcceptance.csv.rawColumn10"
  | "journalAcceptance.csv.rawColumn2"
  | "journalAcceptance.csv.rawColumn3"
  | "journalAcceptance.csv.rawColumn9"
  | "journalAcceptance.errors.addRows"
  | "journalAcceptance.errors.createBatch"
  | "journalAcceptance.errors.deleteRows"
  | "journalAcceptance.errors.expiryDate"
  | "journalAcceptance.errors.fileNoSheets"
  | "journalAcceptance.errors.fileNoValues"
  | "journalAcceptance.errors.import"
  | "journalAcceptance.errors.organoleptic"
  | "journalAcceptance.errors.packaging"
  | "journalAcceptance.errors.productDeliveryDate"
  | "journalAcceptance.errors.productName"
  | "journalAcceptance.errors.rawDeliveryDate"
  | "journalAcceptance.errors.saveDocument"
  | "journalAcceptance.errors.saveLists"
  | "journalAcceptance.errors.saveRow"
  | "journalAcceptance.errors.shelfLifeDate"
  | "journalAcceptance.errors.supplier"
  | "journalAcceptance.errors.transport"
  | "journalAcceptance.feedback.rowsDeleted"
  | "journalAcceptance.focus.later"
  | "journalAcceptance.focus.noCreateBody"
  | "journalAcceptance.iiko.description"
  | "journalAcceptance.iiko.title"
  | "journalAcceptance.import.chooseFile"
  | "journalAcceptance.import.columnsHelp"
  | "journalAcceptance.import.downloadExample"
  | "journalAcceptance.import.dropFile"
  | "journalAcceptance.import.help"
  | "journalAcceptance.import.productColumn1"
  | "journalAcceptance.import.productColumn10"
  | "journalAcceptance.import.productColumn11"
  | "journalAcceptance.import.productColumn2"
  | "journalAcceptance.import.productColumn3"
  | "journalAcceptance.import.productColumn4"
  | "journalAcceptance.import.productColumn5"
  | "journalAcceptance.import.productColumn6"
  | "journalAcceptance.import.productColumn7"
  | "journalAcceptance.import.productColumn8"
  | "journalAcceptance.import.productColumn9"
  | "journalAcceptance.import.rawColumn1"
  | "journalAcceptance.import.rawColumn10"
  | "journalAcceptance.import.rawColumn11"
  | "journalAcceptance.import.rawColumn2"
  | "journalAcceptance.import.rawColumn3"
  | "journalAcceptance.import.rawColumn4"
  | "journalAcceptance.import.rawColumn5"
  | "journalAcceptance.import.rawColumn6"
  | "journalAcceptance.import.rawColumn7"
  | "journalAcceptance.import.rawColumn8"
  | "journalAcceptance.import.rawColumn9"
  | "journalAcceptance.import.title"
  | "journalAcceptance.lists.addFromFile"
  | "journalAcceptance.lists.directoryAction"
  | "journalAcceptance.lists.directoryTitle"
  | "journalAcceptance.lists.fileHelp"
  | "journalAcceptance.lists.manufacturers"
  | "journalAcceptance.lists.newManufacturer"
  | "journalAcceptance.lists.newProduct"
  | "journalAcceptance.lists.newSupplier"
  | "journalAcceptance.lists.products"
  | "journalAcceptance.lists.remove"
  | "journalAcceptance.lists.removeDescription"
  | "journalAcceptance.lists.removeTitle"
  | "journalAcceptance.lists.removed"
  | "journalAcceptance.lists.rename"
  | "journalAcceptance.lists.suppliers"
  | "journalAcceptance.lists.title"
  | "journalAcceptance.lists.usedWarning"
  | "journalAcceptance.rawTable.deliveryDateTime"
  | "journalAcceptance.rawTable.organoleptic"
  | "journalAcceptance.rawTable.packagingCompliance"
  | "journalAcceptance.row.acceptFull"
  | "journalAcceptance.row.addTitle"
  | "journalAcceptance.row.batchExample"
  | "journalAcceptance.row.cardDecision"
  | "journalAcceptance.row.cardDocumentation"
  | "journalAcceptance.row.cardTemperature"
  | "journalAcceptance.row.choose"
  | "journalAcceptance.row.chooseOrAdd"
  | "journalAcceptance.row.compliantShort"
  | "journalAcceptance.row.correctiveActions"
  | "journalAcceptance.row.correctiveExample"
  | "journalAcceptance.row.decision"
  | "journalAcceptance.row.deliveryDateTime"
  | "journalAcceptance.row.deliveryTime"
  | "journalAcceptance.row.docsExample"
  | "journalAcceptance.row.documentCompliantOption"
  | "journalAcceptance.row.documentNonCompliantOption"
  | "journalAcceptance.row.documentationPlaceholder"
  | "journalAcceptance.row.editProgressTitle"
  | "journalAcceptance.row.editTitle"
  | "journalAcceptance.row.expiryDeadline"
  | "journalAcceptance.row.hourOption"
  | "journalAcceptance.row.hourPlaceholder"
  | "journalAcceptance.row.manufacturer"
  | "journalAcceptance.row.minuteOption"
  | "journalAcceptance.row.minutePlaceholder"
  | "journalAcceptance.row.newManufacturer"
  | "journalAcceptance.row.newManufacturerSupplier"
  | "journalAcceptance.row.newProduct"
  | "journalAcceptance.row.newSupplier"
  | "journalAcceptance.row.nonCompliantFull"
  | "journalAcceptance.row.notes"
  | "journalAcceptance.row.organoleptic"
  | "journalAcceptance.row.packaging"
  | "journalAcceptance.row.rejectFull"
  | "journalAcceptance.row.responsiblePosition"
  | "journalAcceptance.row.shelfLifeLabel"
  | "journalAcceptance.row.supplier"
  | "journalAcceptance.row.temperature"
  | "journalAcceptance.row.temperatureExample"
  | "journalAcceptance.row.transport"
  | "journalAcceptance.screen.addDeliveryDesktop"
  | "journalAcceptance.screen.addDeliveryMobile"
  | "journalAcceptance.screen.addIiko"
  | "journalAcceptance.screen.cardsEmpty"
  | "journalAcceptance.screen.closedHint"
  | "journalAcceptance.screen.editLists"
  | "journalAcceptance.screen.emptyBody"
  | "journalAcceptance.screen.emptyTitle"
  | "journalAcceptance.screen.selectionHint"
  | "journalAcceptance.screen.sortByExpiry"
  | "journalAcceptance.screen.tableEmpty"
  | "journalAcceptance.settings.dateFrom"
  | "journalAcceptance.settings.description"
  | "journalAcceptance.settings.documentTitle"
  | "journalAcceptance.settings.expiryDeadlineChoice"
  | "journalAcceptance.settings.fieldName"
  | "journalAcceptance.settings.fieldNameV2"
  | "journalAcceptance.settings.shelfLifeChoice"
  | "journalAcceptance.settings.title"
  | "journalControls.closeDocument.close"
  | "journalControls.closeDocument.networkError"
  | "journalControls.positionSelect.chooseEmployee"
  | "journalControls.positionSelect.employeeLabel"
  | "journalControls.quickAdd.genericError"
  | "journals.names.incoming_control"
  | "journals.names.incoming_raw_materials_control";
export type AcceptanceTranslate = (key: AcceptanceMessageKey, values?: Record<string, string | number>) => string;
export type AcceptanceMessage = { key: AcceptanceMessageKey; values?: Record<string, string | number> };

/** Protocol tuples are shared by the downloader and exact generated-header recognizer. */
export const ACCEPTANCE_IMPORT_HEADER_KEYS = {
  "product": [
    "foodControlPdf.incomingControl.columns.deliveryDate",
    "foodControlPdf.incomingControl.columns.productName",
    "foodControlPdf.incomingControl.columns.shelfLifeDate",
    "foodControlPdf.incomingControl.columns.manufacturerSupplier",
    "foodControlPdf.incomingControl.columns.accompanyingDocs",
    "foodControlPdf.incomingControl.columns.batchInfo",
    "journalAcceptance.csv.productColumn7",
    "foodControlPdf.incomingControl.columns.documentCompliance",
    "journalAcceptance.csv.productColumn9",
    "journalAcceptance.csv.productColumn10",
    "foodControlPdf.incomingControl.columns.responsible"
  ],
  "raw": [
    "journalAcceptance.csv.rawColumn1",
    "journalAcceptance.csv.rawColumn2",
    "journalAcceptance.csv.rawColumn3",
    "journalAcceptance.row.manufacturer",
    "journalAcceptance.row.supplier",
    "journalAcceptance.row.transport",
    "journalAcceptance.row.packaging",
    "journalAcceptance.row.organoleptic",
    "journalAcceptance.csv.rawColumn9",
    "journalAcceptance.csv.rawColumn10",
    "foodControlPdf.acceptance.columns.notes"
  ]
} as const satisfies Record<"product" | "raw", readonly AcceptanceMessageKey[]>;
// Generated finite EN/UZ protocol aliases; tests bind every cell to its catalog key.
export const ACCEPTANCE_GENERATED_HEADER_PROFILES = {
  "product": [
    [
      "Delivery date",
      "Product name",
      "Use by",
      "Manufacturer/supplier",
      "Waybill and compliance documents",
      "Volume, batch number, production date",
      "Internal product temp.",
      "Product compliance with accompanying documents",
      "Accept/Reject (П/О)",
      "Corrective actions",
      "Responsible person"
    ],
    [
      "Yetkazib berilgan sana",
      "Mahsulot nomi",
      "Yaroqlilik muddati",
      "Ishlab chiqaruvchi/yetkazib beruvchi",
      "Yuk xati va muvofiqlik hujjatlari",
      "Hajmi, partiya raqami, ishlab chiqarilgan sana",
      "Mahsulotning ichki harorati",
      "Mahsulot ilova hujjatlariga muvofiqligi",
      "Qabul qilish/Rad etish (П/О)",
      "Tuzatish choralari",
      "Mas’ul shaxs"
    ]
  ],
  "raw": [
    [
      "Receipt date",
      "Receipt time",
      "Name",
      "Manufacturer",
      "Supplier",
      "Transport conditions",
      "Packaging compliance",
      "Organoleptic results",
      "Sale deadline date",
      "Sale deadline time",
      "Notes"
    ],
    [
      "Qabul sanasi",
      "Qabul vaqti",
      "Nomi",
      "Ishlab chiqaruvchi",
      "Yetkazib beruvchi",
      "Tashish sharoitlari",
      "Qadoqning muvofiqligi",
      "Organoleptik baholash natijalari",
      "Sotish muddati sanasi",
      "Sotish muddati vaqti",
      "Izohlar"
    ]
  ]
} as const;

export function acceptanceImportHeaders(product: boolean, t: AcceptanceTranslate): string[] {
  return (product ? ACCEPTANCE_IMPORT_HEADER_KEYS.product : ACCEPTANCE_IMPORT_HEADER_KEYS.raw).map((key) => t(key));
}

/** Input cells have already passed through the existing XLSX/text normalization. */
export function isGeneratedAcceptanceImportHeader(cells: readonly string[], product: boolean): boolean {
  const profiles = product ? ACCEPTANCE_GENERATED_HEADER_PROFILES.product : ACCEPTANCE_GENERATED_HEADER_PROFILES.raw;
  return cells.length === 11 && profiles.some((profile) => profile.every((cell, index) => cell === cells[index]));
}

export function acceptanceEnumLabel(field: "transport" | "packaging" | "organoleptic" | "decision", value: string, t: AcceptanceTranslate): string {
  if (field === "packaging") {
    if (value === "compliant") return t("journalAcceptance.row.compliantShort");
    if (value === "non_compliant") return t("foodControlPdf.acceptance.status.nonCompliant");
  } else if (field === "decision") {
    if (value === "accept") return t("foodControlPdf.incomingControl.decision.accept");
    if (value === "reject") return t("foodControlPdf.incomingControl.decision.reject");
  } else {
    if (value === "satisfactory") return t("foodControlPdf.acceptance.status.satisfactory");
    if (value === "unsatisfactory") return t("foodControlPdf.acceptance.status.unsatisfactory");
  }
  return value;
}

export function acceptanceProductColumns(packaging: boolean, t: AcceptanceTranslate): string[] {
  const keys: AcceptanceMessageKey[] = [
    "foodControlPdf.incomingControl.columns.deliveryDate",
    "foodControlPdf.incomingControl.columns.productName",
    "foodControlPdf.incomingControl.columns.shelfLifeDate",
    "foodControlPdf.incomingControl.columns.manufacturerSupplier",
    "foodControlPdf.incomingControl.columns.accompanyingDocs",
    "foodControlPdf.incomingControl.columns.batchInfo",
    "foodControlPdf.incomingControl.columns.productTemperature",
    "foodControlPdf.incomingControl.columns.documentCompliance",
    ...(packaging ? ["foodControlPdf.incomingControl.columns.packagingCompliance" as const] : []),
    "foodControlPdf.incomingControl.columns.acceptanceDecision",
    "foodControlPdf.incomingControl.columns.correctiveActions",
    "foodControlPdf.incomingControl.columns.responsible",
  ];
  return keys.map((key) => t(key));
}

const ownedErrors = new WeakMap<Error, readonly AcceptanceMessage[]>();
export function tagAcceptanceError<T extends Error>(error: T, messages: readonly AcceptanceMessage[]): T {
  ownedErrors.set(error, messages);
  return error;
}

export type AcceptanceDiagnostic = { raw: string; messages?: readonly AcceptanceMessage[] };
const fallbackMarker = Object.freeze({});
const networkMarker = Object.freeze({});

/** Run exactly the original raw error reader, once. Never classify an error by Russian prose. */
export function captureAcceptanceDiagnostic(error: unknown, fallback: string, key: AcceptanceMessageKey): AcceptanceDiagnostic {
  const result = humanizeFetchError(error, fallbackMarker as unknown as string, networkMarker as unknown as string);
  if (result === (networkMarker as unknown as string)) {
    return { raw: NO_CONNECTION_MESSAGE, messages: [{ key: "journalControls.closeDocument.networkError" }] };
  }
  if (result === (fallbackMarker as unknown as string)) return { raw: fallback, messages: [{ key }] };
  const messages = ownedErrors.get(error as Error);
  return messages ? { raw: result, messages } : { raw: result };
}

export function formatAcceptanceDiagnostic(diagnostic: AcceptanceDiagnostic, t: AcceptanceTranslate): string {
  return diagnostic.messages ? diagnostic.messages.map(({ key, values }) => t(key, values)).join("\n") : diagnostic.raw;
}

type SummaryEnums = Pick<AcceptanceRow, "packagingCompliance" | "transportCondition" | "organolepticResult">;
type SummaryCandidate = { index: number } & SummaryEnums;
export type AcceptanceSummarySidecar = { id: string; raw: string } & SummaryEnums;

/** Inspect own data descriptors only; JSON primitives cannot invoke getters or coercions. */
function ownData(value: unknown): Record<string, PropertyDescriptor> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => !("value" in descriptor))) return null;
  return descriptors;
}

/** Must run before the existing sole business normalizer. It never calls that normalizer. */
export function captureAcceptanceSummarySource(value: unknown): readonly SummaryCandidate[] {
  try {
    const config = ownData(value);
    const rows = config?.rows?.value;
    if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype) return [];
    const rowDescriptors = Object.getOwnPropertyDescriptors(rows);
    if (Object.values(rowDescriptors).some((descriptor) => !("value" in descriptor))) return [];
    const candidates: SummaryCandidate[] = [];
    let index = 0;
    for (let position = 0; position < rows.length; position += 1) {
      if (!Object.prototype.hasOwnProperty.call(rowDescriptors, String(position))) return [];
      const raw = rowDescriptors[String(position)]?.value;
      // Match exactly the normalizer's existing valid-row filter, without reading row fields.
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const normalizedIndex = index++;
      const row = ownData(raw);
      if (!row || Object.prototype.hasOwnProperty.call(row, "documentCompliance")) continue;
      const legacy = ["transportCondition", "packagingCompliance", "organolepticResult", "decision"] as const;
      if (!legacy.some((key) => Object.prototype.hasOwnProperty.call(row, key))) continue;
      const transport = row.transportCondition?.value;
      const packaging = row.packagingCompliance?.value;
      const organoleptic = row.organolepticResult?.value;
      const decision = row.decision?.value;
      if (![undefined, null, "", "satisfactory", "unsatisfactory"].includes(transport)) continue;
      if (![undefined, null, "", "compliant", "non_compliant", "no"].includes(packaging)) continue;
      if (![undefined, null, "", "satisfactory", "unsatisfactory", "reject"].includes(organoleptic)) continue;
      if (![undefined, null, "", "accept", "reject", "satisfactory", "unsatisfactory"].includes(decision)) continue;
      // A non-JSON object anywhere on the row is uncertain source material; leave it raw.
      if (Object.values(row).some(({ value: item }) => item !== null && !["undefined", "string", "number", "boolean"].includes(typeof item))) continue;
      candidates.push({ index: normalizedIndex,
        transportCondition: transport === "unsatisfactory" ? "unsatisfactory" : "satisfactory",
        packagingCompliance: packaging === "non_compliant" || packaging === "no" ? "non_compliant" : "compliant",
        organolepticResult: (organoleptic || decision) === "unsatisfactory" || (organoleptic || decision) === "reject" ? "unsatisfactory" : "satisfactory",
      });
    }
    return candidates;
  } catch {
    return [];
  }
}

export function bindAcceptanceSummarySource(source: readonly SummaryCandidate[], config: AcceptanceDocumentConfig): readonly AcceptanceSummarySidecar[] {
  return source.flatMap((candidate) => {
    const row = config.rows[candidate.index];
    if (!row || !sameSummaryEnums(candidate, row) || typeof row.documentCompliance !== "string") return [];
    return [{ id: row.id, raw: row.documentCompliance, packagingCompliance: row.packagingCompliance,
      transportCondition: row.transportCondition, organolepticResult: row.organolepticResult }];
  });
}

function sameSummaryEnums(left: SummaryEnums, right: SummaryEnums): boolean {
  return left.packagingCompliance === right.packagingCompliance && left.transportCondition === right.transportCondition && left.organolepticResult === right.organolepticResult;
}

/** Bind serialized provenance to the exact normalized client row objects; edits lose this identity. */
export function bindAcceptanceSummaryRows(config: AcceptanceDocumentConfig, sidecar: readonly AcceptanceSummarySidecar[]): WeakMap<AcceptanceRow, AcceptanceSummarySidecar> {
  const result = new WeakMap<AcceptanceRow, AcceptanceSummarySidecar>();
  for (const row of config.rows) {
    const matches = sidecar.filter((entry) => entry.id === row.id);
    if (matches.length === 1 && matches[0].raw === row.documentCompliance && sameSummaryEnums(matches[0], row)) result.set(row, matches[0]);
  }
  return result;
}

export function acceptanceSummaryDisplay(row: AcceptanceRow, bindings: WeakMap<AcceptanceRow, AcceptanceSummarySidecar>, t: AcceptanceTranslate): string {
  const source = bindings.get(row);
  if (!source || source.raw !== row.documentCompliance || !sameSummaryEnums(source, row)) return row.documentCompliance;
  return t("foodControlPdf.incomingControl.legacyComplianceSummary", {
    packaging: acceptanceEnumLabel("packaging", row.packagingCompliance, t),
    transport: acceptanceEnumLabel("transport", row.transportCondition, t),
    organoleptic: acceptanceEnumLabel("organoleptic", row.organolepticResult, t),
  });
}

/** Optional strings only: date arithmetic and persisted ISO values stay with DateField. */
export function acceptanceCalendarCopy(t: AcceptanceTranslate) {
  return {
    placeholder: t("journalAcceptance.calendar.placeholder"), open: t("journalAcceptance.calendar.open"),
    previousMonth: t("journalAcceptance.calendar.previousMonth"), nextMonth: t("journalAcceptance.calendar.nextMonth"),
    months: Array.from({ length: 12 }, (_, index) => t(`journalAcceptance.calendar.month${index + 1}` as AcceptanceMessageKey)),
    heading: (month: string, year: number) => t("journalAcceptance.calendar.heading", { month, year: String(year) }),
    weekdays: Array.from({ length: 7 }, (_, index) => t(`journalAcceptance.calendar.weekday${index + 1}` as AcceptanceMessageKey)),
  };
}

/** Persisted-source witnesses exclude IDs allocated during server normalization. */
export function acceptanceServerRevision(
  documentId: string,
  config: unknown,
  users: unknown,
  generatedSummaries: readonly AcceptanceSummarySidecar[] | undefined,
  sourceIdentity?: string,
): string {
  return sourceIdentity === undefined
    ? JSON.stringify([documentId, config, users, generatedSummaries])
    : JSON.stringify([documentId, sourceIdentity]);
}

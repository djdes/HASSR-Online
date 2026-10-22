export const SCAN_HEADING_KEYS = {
  audit_plan_scan: "journals.names.audit_plan_scan",
  audit_report_scan: "journals.names.audit_report_scan",
  audit_protocol_scan: "journals.names.audit_protocol_scan",
  metal_impurity_scan: "journals.names.metal_impurity_scan",
} as const;

export type ScanHeadingKey = typeof SCAN_HEADING_KEYS[keyof typeof SCAN_HEADING_KEYS];
export type ScanMetadataKey =
  | "journalScan.metadata.documentDate"
  | "journalScan.metadata.startDate"
  | "journalScan.metadata.period"
  | "journalScan.metadata.responsible"
  | "journalScan.metadata.approverPosition";
export type ScanDisplayKey = ScanHeadingKey | ScanMetadataKey;
export type ScanMessageKey = ScanDisplayKey
  | "journalScan.focus.emptyTitle"
  | "journalScan.focus.emptyBody"
  | "journalScan.focus.noCreateBody"
  | "journalScan.focus.later"
  | "journalScan.document.pageSubtitle"
  | "journalScan.document.imageAlt"
  | "journalScan.document.previous"
  | "journalScan.document.next"
  | "journalScan.list.creating"
  | "journalScan.shared.label"
  | "journalScan.shared.title"
  | "common.close"
  | "common.delete"
  | "journalControls.documentDialog.createError"
  | "journalControls.documentActions.deleteTitle"
  | "journalControls.documentLifecycle.deleteDescriptionWithTitle"
  | "journalControls.documentActions.deleteError"
  | "journalControls.list.create";
export type ScanTranslate = (key: ScanMessageKey, values?: Record<string, string | number>) => string;

/** A key is supplied only by the server's original explicit config/falsy branch. */
export function scanHeadingKey(code: string): ScanHeadingKey | undefined {
  if (typeof code !== "string" || !Object.hasOwn(SCAN_HEADING_KEYS, code)) return undefined;
  return SCAN_HEADING_KEYS[code as keyof typeof SCAN_HEADING_KEYS];
}

export function scanDateLabelKey(code: string, configuredLabelIsTruthy: boolean): ScanMetadataKey | undefined {
  if (!configuredLabelIsTruthy) return "journalScan.metadata.period";
  if (!scanHeadingKey(code)) return undefined;
  return code === "metal_impurity_scan" ? "journalScan.metadata.startDate" : "journalScan.metadata.documentDate";
}

export function scanResponsibleLabelKey(code: string): ScanMetadataKey | undefined {
  if (code === "audit_plan_scan") return "journalScan.metadata.approverPosition";
  if (code === "metal_impurity_scan") return "journalScan.metadata.responsible";
  return undefined;
}

const DISPLAY_KEYS = new Set<string>([
  ...Object.values(SCAN_HEADING_KEYS),
  "journalScan.metadata.documentDate", "journalScan.metadata.startDate",
  "journalScan.metadata.period", "journalScan.metadata.responsible", "journalScan.metadata.approverPosition",
]);

/** Unknown metadata remains raw; no Russian text is used to guess provenance. */
export function scanDisplayText(raw: string, key: ScanDisplayKey | undefined, t: ScanTranslate): string {
  return key && DISPLAY_KEYS.has(key) ? t(key) : raw;
}

export function scanResponsibleLabel(
  raw: string | null | undefined,
  key: ScanDisplayKey | undefined,
  t: ScanTranslate,
): string {
  return raw ? scanDisplayText(raw, key, t) : t("journalScan.metadata.responsible");
}

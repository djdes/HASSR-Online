import type { useTranslations } from "next-intl";
import { getAuditPlanPrintDateLabel, type AuditPlanConfig } from "@/lib/audit-plan-document";
import { normalizeUserRole, USER_ROLE_LABELS, type UserRole } from "@/lib/user-roles";

const ROW_KEYS = ["planRow0", "planRow1", "planRow2", "planRow3", "planRow4", "planRow5", "planRow6", "planRow7", "planRow8", "planRow9", "planRow10", "planRow11", "planRow12", "planRow13", "planRow14", "planRow15", "planRow16", "planRow17", "planRow18", "planRow19", "planRow20", "planRow21", "planRow22"] as const;
const SECTION_KEYS = ["planSection0", "planSection1", "planSection2"] as const;
export type AuditPlanPdfKey = typeof ROW_KEYS[number] | typeof SECTION_KEYS[number] | UserRole | "planTitle" | "planColumn" | "organization" | "approvalDate" | "approved";
declare const auditPlanTranslator: ReturnType<typeof useTranslations<"auditTraceabilityPdf">>;
export type AuditPlanPdfCopy = <Key extends AuditPlanPdfKey>(...args: Parameters<typeof auditPlanTranslator<Key>>) => string;
export type AuditPlanLocale = "ru" | "en" | "uz";

type DataSlot = { kind: "data"; value: unknown } | { kind: "absent" } | { kind: "unsafe" };
function ownData(value: unknown, key: string): DataSlot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "unsafe" };
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return { kind: "unsafe" };
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return { kind: "absent" };
    return "value" in descriptor ? { kind: "data", value: descriptor.value } : { kind: "unsafe" };
  } catch { return { kind: "unsafe" }; }
}

type Baseline = { id: string; value: string; organization?: string };
export type AuditPlanDisplayProvenance = {
  version: 1;
  columns: boolean;
  sections: boolean;
  rows: boolean;
  approveRole: boolean;
  organizationFallback: boolean;
  baseline?: { columns: Baseline[]; sections: Baseline[]; rows: Baseline[] };
};

/** Inspect descriptors before the original normalizer; never invoke raw getters. */
export function captureAuditPlanProvenance(raw: unknown, organizationFallback = false): AuditPlanDisplayProvenance {
  const factory = !raw || typeof raw !== "object" || Array.isArray(raw);
  const absent = (field: string) => factory || ownData(raw, field).kind === "absent";
  return { version: 1, columns: absent("columns"), sections: absent("sections"), rows: absent("rows"), approveRole: absent("approveRole"), organizationFallback };
}

/** A descriptor witness of the original organization-name || fallback branch. */
export function auditPlanOrganizationFallback(organization: unknown): boolean {
  if (organization == null) return true;
  const name = ownData(organization, "name");
  return name.kind === "absent" || (name.kind === "data" && !name.value);
}

/** Bind only proved factory fields to their original normalized values. Never persist. */
export function completeAuditPlanProvenance(origin: AuditPlanDisplayProvenance, config: AuditPlanConfig): AuditPlanDisplayProvenance {
  if (origin.baseline) return origin;
  return { ...origin, baseline: {
    columns: origin.columns ? config.columns.map((item, index) => ({ id: item.id, value: item.title,
      organization: item.title.startsWith(`\u0410\u0443\u0434\u0438\u0442 ${index + 1} `) ? item.title.slice(`\u0410\u0443\u0434\u0438\u0442 ${index + 1} `.length) : undefined })) : [],
    sections: origin.sections ? config.sections.map(item => ({ id: item.id, value: item.title })) : [],
    rows: origin.rows ? config.rows.map(item => ({ id: item.id, value: item.text })) : [],
  } };
}

/** Preserve one original raw read and one original normalizer call, in that order. */
export function auditPlanConfigWithDisplay(raw: unknown, normalize: (raw: unknown) => AuditPlanConfig, organizationFallback = false) {
  const captured = captureAuditPlanProvenance(raw, organizationFallback);
  const config = normalize(raw);
  return { config, displayProvenance: completeAuditPlanProvenance(captured, config) };
}

/** Keep the original business title fallback feeding copy inputs completely unchanged. */
export function captureAuditPlanTitle<T>(value: T, fallback: () => string) {
  return { title: value || fallback(), displayTitleMissing: !value };
}
export function presentAuditPlanTitle<T>(value: T, missing: boolean | undefined, standard: string): T | string {
  return !value || missing ? standard : value;
}

export function presentAuditPlanItem(kind: "columns" | "sections" | "rows", item: { id: string; title?: string; text?: string }, origin: AuditPlanDisplayProvenance, t: AuditPlanPdfCopy): string {
  const value = kind === "rows" ? item.text || "" : item.title || "";
  if (!origin[kind] || !origin.baseline) return value;
  const index = origin.baseline[kind].findIndex(entry => entry.id === item.id && entry.value === value);
  if (index < 0) return value;
  if (kind === "columns") {
    const original = origin.baseline.columns[index];
    if (index > 1 || original.organization === undefined) return value;
    return t("planColumn", { number: String(index + 1), organization: origin.organizationFallback ? t("organization") : original.organization });
  }
  const key = kind === "rows" ? ROW_KEYS[index] : SECTION_KEYS[index];
  return key ? t(key) : value;
}

type RoleDisplay = { byLabel: ReadonlyMap<string, UserRole>; byUserId: ReadonlyMap<string, UserRole> };
/** Closed enum origin first; Russian text is merely the unchanged raw option identity. */
export function buildAuditPlanRoleDisplay(users: readonly unknown[]): RoleDisplay {
  const candidates = new Map<string, UserRole>();
  const byUserId = new Map<string, UserRole>();
  const blocked = new Set<string>();
  let unsafe = false;
  for (const user of users) {
    const job = ownData(user, "jobPosition");
    const position = ownData(user, "positionTitle");
    const role = ownData(user, "role");
    const id = ownData(user, "id");
    if ([job, position, role, id].some(slot => slot.kind === "unsafe")) { unsafe = true; continue; }
    let jobName: DataSlot = { kind: "absent" };
    if (job.kind === "data" && job.value != null) jobName = ownData(job.value, "name");
    if (jobName.kind === "unsafe") { unsafe = true; continue; }
    const customJob = jobName.kind === "data" && typeof jobName.value === "string" ? jobName.value.trim() : "";
    const customPosition = position.kind === "data" && typeof position.value === "string" ? position.value.trim() : "";
    if ((jobName.kind === "data" && jobName.value != null && typeof jobName.value !== "string") ||
        (position.kind === "data" && position.value != null && typeof position.value !== "string")) { unsafe = true; continue; }
    const custom = customJob || customPosition;
    if (custom) { blocked.add(custom); continue; }
    if (role.kind !== "data" || typeof role.value !== "string" || !role.value) { blocked.add(USER_ROLE_LABELS.cook); continue; }
    const normalized = normalizeUserRole(role.value);
    if (!Object.hasOwn(USER_ROLE_LABELS, normalized)) { blocked.add(normalized); continue; }
    const key = normalized as UserRole;
    candidates.set(USER_ROLE_LABELS[key], key);
    if (id.kind === "data" && typeof id.value === "string") byUserId.set(id.value, key);
  }
  if (unsafe) return { byLabel: new Map(), byUserId: new Map() };
  for (const raw of blocked) candidates.delete(raw);
  for (const [id, role] of byUserId) if (!candidates.has(USER_ROLE_LABELS[role])) byUserId.delete(id);
  return { byLabel: candidates, byUserId };
}
export function presentAuditPlanRoleLabel(rawLabel: string, display: RoleDisplay, t: AuditPlanPdfCopy): string {
  const role = display.byLabel.get(rawLabel);
  return role ? t(role) : rawLabel;
}
export function presentAuditPlanApproverTitle(rawTitle: string, config: AuditPlanConfig, users: readonly unknown[], origin: AuditPlanDisplayProvenance, t: AuditPlanPdfCopy): string {
  const display = buildAuditPlanRoleDisplay(users);
  const role = display.byUserId.get(config.approveEmployeeId?.trim() || "");
  if (role && rawTitle === USER_ROLE_LABELS[role]) return t(role);
  if (users.length === 0 && origin.approveRole && rawTitle === USER_ROLE_LABELS.manager) return t("manager");
  return rawTitle;
}

export function presentAuditPlanApprovalDate(value: string, locale: AuditPlanLocale, t: AuditPlanPdfCopy): string {
  if (locale === "ru") return getAuditPlanPrintDateLabel(value);
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  const date = new Date(`${year}-${month}-${day}T00:00:00`);
  const monthName = date.toLocaleDateString(locale === "en" ? "en-US" : "uz-Latn-UZ", { month: "long" });
  return t("approvalDate", { day, month: monthName, year });
}

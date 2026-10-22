import type { useTranslations } from "next-intl";
import type { TrainingPlanConfig } from "@/lib/training-plan-document";
import { normalizeUserRole, USER_ROLE_LABELS, type UserRole } from "@/lib/user-roles";
import { getRealUserName } from "@/lib/user-display-name";

export type TrainingCopyKey = UserRole | "kkt" | "sanitation" | "duties" | "safety" | "fire" | "approvalDate";
declare const trainingTranslator: ReturnType<typeof useTranslations<"personnelMaintenancePdf">>;
export type TrainingCopy = <Key extends TrainingCopyKey>(...args: Parameters<typeof trainingTranslator<Key>>) => string;
type DataSlot = { kind: "data"; value: unknown } | { kind: "absent" } | { kind: "unsafe" };

/** Descriptors do not invoke getters or add reads to the native normalizer. */
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

type Baseline = { id: string; value: string };
export type TrainingDisplayProvenance = {
  topics: boolean;
  rows: boolean;
  approveRole: boolean;
  baseline?: { topics: Baseline[]; rows: Baseline[] };
};

/** Match native map/filter default branches without invoking any item accessors. */
function injectedTrainingArray(slot: DataSlot, kind: "topics" | "rows"): boolean {
  if (slot.kind === "unsafe") return false;
  if (slot.kind === "absent" || !Array.isArray(slot.value)) return true;
  try {
    const values = slot.value;
    if (Object.getPrototypeOf(values) !== Array.prototype) return false;
    // Sparse native map skips absent slots, except inherited numeric properties.
    if (Object.getOwnPropertyNames(Array.prototype).some(key => /^(0|[1-9]\d*)$/.test(key))) return false;
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(values);
    const length = descriptors.length;
    if (!length || !("value" in length)) return false;
    let uncertain = false;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) return false;
      const item = descriptors[key];
      if (!("value" in item)) return false;
      const value: unknown = item.value;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      if (kind === "rows") {
        // Every object row survives the native filter, regardless of its fields.
        return false;
      }
      const id = ownData(value, "id"), name = ownData(value, "name");
      if (id.kind === "unsafe" || name.kind === "unsafe") { uncertain = true; continue; }
      if (id.kind === "data" && typeof id.value === "string" && id.value &&
          name.kind === "data" && typeof name.value === "string" && name.value) return false;
    }
    return !uncertain;
  } catch { return false; }
}

export function captureTrainingProvenance(raw: unknown): TrainingDisplayProvenance {
  const factory = !raw || typeof raw !== "object" || Array.isArray(raw);
  const role: DataSlot = factory ? { kind: "absent" } : ownData(raw, "approveRole");
  return {
    topics: factory || injectedTrainingArray(ownData(raw, "topics"), "topics"),
    rows: factory || injectedTrainingArray(ownData(raw, "rows"), "rows"),
    // Training safeText preserves whitespace; only non-string/empty values fall back.
    approveRole: role.kind === "absent" || (role.kind === "data" && (typeof role.value !== "string" || !role.value)),
  };
}
export function completeTrainingProvenance(origin: TrainingDisplayProvenance, config: TrainingPlanConfig): TrainingDisplayProvenance {
  return { ...origin, baseline: {
    topics: origin.topics ? config.topics.map(item => ({ id: item.id, value: item.name })) : [],
    rows: origin.rows ? config.rows.map(item => ({ id: item.id, value: item.positionName })) : [],
  } };
}

const TOPIC_KEYS = ["kkt", "sanitation", "duties", "safety", "fire"] as const;
const ROW_ROLES = { "row-1": "head_chef", "row-2": "cook", "row-3": "waiter" } as const;
export function presentTrainingItem(kind: "topics" | "rows", item: { id: string; name?: string; positionName?: string }, origin: TrainingDisplayProvenance, t: TrainingCopy): string {
  const raw = kind === "topics" ? item.name || "" : item.positionName || "";
  if (!origin[kind] || !origin.baseline?.[kind].some(entry => entry.id === item.id && entry.value === raw)) return raw;
  if (kind === "topics") {
    const key = TOPIC_KEYS.find(key => key === item.id);
    return key ? t(key) : raw;
  }
  const key = ROW_ROLES[item.id as keyof typeof ROW_ROLES];
  return key ? t(key) : raw;
}

type RoleDisplay = { byLabel: ReadonlyMap<string, UserRole>; byUserId: ReadonlyMap<string, UserRole> };
/** Custom titles block enum translation even when the two raw labels collide. */
export function buildTrainingRoleDisplay(users: readonly unknown[]): RoleDisplay {
  const candidates = new Map<string, UserRole>();
  const byUserId = new Map<string, UserRole>();
  const blocked = new Set<string>();
  let unsafe = false;
  for (const user of users) {
    const job = ownData(user, "jobPosition"), position = ownData(user, "positionTitle"), role = ownData(user, "role"), id = ownData(user, "id");
    if ([job, position, role, id].some(slot => slot.kind === "unsafe")) { unsafe = true; continue; }
    let jobName: DataSlot = { kind: "absent" };
    if (job.kind === "data" && job.value != null) jobName = ownData(job.value, "name");
    if (jobName.kind === "unsafe") { unsafe = true; continue; }
    if ((jobName.kind === "data" && jobName.value != null && typeof jobName.value !== "string") ||
        (position.kind === "data" && position.value != null && typeof position.value !== "string")) { unsafe = true; continue; }
    const customJob = jobName.kind === "data" && typeof jobName.value === "string" ? jobName.value.trim() : "";
    const customPosition = position.kind === "data" && typeof position.value === "string" ? position.value.trim() : "";
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
export function presentTrainingRole(raw: string, display: RoleDisplay, t: TrainingCopy): string {
  const role = display.byLabel.get(raw);
  return role ? t(role) : raw;
}
/** Keep the existing native label builder; translate only descriptor-proved enum/fallback spans. */
export function presentTrainingStaffOption(raw: string, user: unknown, display: RoleDisplay, t: TrainingCopy, unnamed: string): string {
  const id = ownData(user, "id"), name = ownData(user, "name"), email = ownData(user, "email");
  if ([id, name, email].some(slot => slot.kind === "unsafe")) return raw;
  let result = raw;
  const role = id.kind === "data" && typeof id.value === "string" ? display.byUserId.get(id.value) : undefined;
  if (role) {
    const prefix = `${USER_ROLE_LABELS[role]} - `;
    if (result.startsWith(prefix)) result = `${t(role)} - ${result.slice(prefix.length)}`;
  }
  const safeName = name.kind === "data" && (typeof name.value === "string" || name.value == null) ? name.value : undefined;
  const safeEmail = email.kind === "data" && (typeof email.value === "string" || email.value == null) ? email.value : undefined;
  if ((name.kind === "data" && name.value !== undefined && safeName === undefined) || (email.kind === "data" && email.value !== undefined && safeEmail === undefined)) return result;
  if (getRealUserName({ name: safeName, email: safeEmail }) === null && result.endsWith(" - без имени")) {
    return result.slice(0, -"без имени".length) + unnamed;
  }
  return result;
}
export function presentTrainingApprover(raw: string, config: TrainingPlanConfig, users: readonly unknown[], origin: TrainingDisplayProvenance, t: TrainingCopy): string {
  const role = buildTrainingRoleDisplay(users).byUserId.get(config.approveEmployeeId?.trim() || "");
  if (role && raw === USER_ROLE_LABELS[role]) return t(role);
  if (!config.approveEmployeeId && origin.approveRole && raw === USER_ROLE_LABELS.manager) return t("manager");
  return raw;
}

export function trainingMonthLabels(locale: string): string[] {
  return Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(locale === "en" ? "en-US" : locale === "uz" ? "uz-Latn-UZ" : "ru-RU", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, index, 1))));
}
export function trainingApprovalDate(dateKey: string, locale: string, t: TrainingCopy): string {
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day) return dateKey;
  // Preserve the original native Date construction, exception behavior and RU genitive month.
  const monthName = new Date(`${year}-${month}-${day}T00:00:00`)
    .toLocaleDateString(locale === "en" ? "en-US" : locale === "uz" ? "uz-Latn-UZ" : "ru-RU", { day: "numeric", month: "long" });
  if (locale !== "en" && locale !== "uz") return `« ${day} » ${monthName.replace(/^\d+\s+/, "")} ${year} г.`;
  const localizedMonth = new Date(`${year}-${month}-${day}T00:00:00`).toLocaleDateString(locale === "en" ? "en-US" : "uz-Latn-UZ", { month: "long" });
  return t("approvalDate", { day, month: localizedMonth, year });
}

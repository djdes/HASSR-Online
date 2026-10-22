import { normalizeUserRole, USER_ROLE_LABELS, type UserRole } from "@/lib/user-roles";
import { getRealUserName } from "@/lib/user-display-name";

type StaffTrainingRoleCopy = (key: UserRole) => string;

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

type RoleDisplay = { byLabel: ReadonlyMap<string, UserRole>; byUserId: ReadonlyMap<string, UserRole> };
/** Custom titles block enum translation even when the two raw labels collide. */
export function buildStaffTrainingRoleDisplay(users: readonly unknown[]): RoleDisplay {
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
    if (role.kind === "data" && role.value != null && typeof role.value !== "string") { blocked.add(USER_ROLE_LABELS.cook); continue; }
    const normalized = normalizeUserRole(role.kind === "data" ? role.value as string | null | undefined : undefined);
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
export function presentStaffTrainingRole(raw: string, display: RoleDisplay, t: StaffTrainingRoleCopy): string {
  const role = display.byLabel.get(raw);
  return role ? t(role) : raw;
}
/** Keep the existing native label builder; translate only descriptor-proved enum/fallback spans. */
export function presentStaffTrainingStaffOption(raw: string, user: unknown, display: RoleDisplay, t: StaffTrainingRoleCopy, unnamed: string): string {
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

/** Serialize only ordinary own data without invoking getters or toJSON hooks.
 * Undefined deliberately disables extra synchronization for exotic objects;
 * the existing normalizer remains responsible for their native read behavior.
 */
export function staffTrainingServerRevision(value: unknown, fields?: readonly string[]): string | undefined {
  const seen = new Set<object>();
  function copy(input: unknown): unknown {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (input === undefined) return undefined;
    if (typeof input !== "object" || seen.has(input)) throw new Error("Unsafe revision");
    const array = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    if ((!array && prototype !== Object.prototype && prototype !== null) || (array && prototype !== Array.prototype)) throw new Error("Unsafe revision");
    seen.add(input);
    const result: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
    for (const key of input === value && fields ? fields : Object.keys(input).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor) continue;
      if (!("value" in descriptor)) throw new Error("Unsafe revision");
      Object.defineProperty(result, key, { value: copy(descriptor.value), enumerable: true, writable: true, configurable: true });
    }
    seen.delete(input);
    return result;
  }
  try { return JSON.stringify(copy(value)); } catch { return undefined; }
}

/** The original server label already chose the day and timezone. Translate its
 * display punctuation without shifting the underlying day or reparsing ISO data.
 */
export function presentStaffTrainingStartDate(raw: string, locale: string): string {
  if (locale !== "en" && locale !== "uz") return raw;
  const parts = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);
  if (!parts) return raw;
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "uz-Latn-UZ", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(parts[3]), Number(parts[2]) - 1, Number(parts[1]))));
}

/** A server witness covers raw config and every directory input to the original
 * normalizer, excluding only values it newly allocated. Legacy callers keep the
 * established normalized-config revision when the optional witness is absent.
 */
export function staffTrainingIncomingRevision(initialConfig: unknown, sourceIdentity?: string, users?: readonly unknown[]): string | undefined {
  return sourceIdentity === undefined
    ? staffTrainingServerRevision(initialConfig)
    : staffTrainingServerRevision([sourceIdentity, users]);
}

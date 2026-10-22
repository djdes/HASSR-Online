import { getUserDisplayTitle, getUserRoleLabel, normalizeUserRole } from "@/lib/user-roles";
import { getPpeIssuanceRecipientLabel, type PpeIssuanceRow } from "@/lib/ppe-issuance-document";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

type User = { id: string; name: string; role?: string | null; positionTitle?: string | null; jobPosition?: { name?: string | null } | null };
type Role = "manager" | "head_chef" | "cook" | "waiter";
export function ppeRole(value: string, user: User | undefined, copy: (key: Role) => string) {
  if (!user || user.positionTitle?.trim() || user.jobPosition?.name?.trim()) return value;
  const role = normalizeUserRole(user.role);
  return role === "manager" || role === "head_chef" || role === "cook" || role === "waiter" ? copy(role) : value;
}
/** Ambiguous custom-identical options remain raw, even alongside managed enums. */
export function ppePositionOption(value: string, users: readonly User[], copy: (key: Role) => string) {
  const matched = users.filter(user => getUserDisplayTitle(user) === value);
  if (!matched.length || matched.some(user => user.positionTitle?.trim() || user.jobPosition?.name?.trim())) return value;
  const labels = new Set(matched.map(user => ppeRole(value, user, copy)));
  return labels.size === 1 ? [...labels][0] : value;
}
/** The legacy list derives options from role enums, independently of custom titles. */
export function ppeLegacyPositionOption(value: string, users: readonly User[], copy: (key: Role) => string) {
  const matched = users.filter(user => getUserRoleLabel(user.role) === value);
  if (!matched.length) return value;
  // A custom-identical label is deliberately preserved when provenance collides.
  if (matched.some(user => (user.positionTitle?.trim() || user.jobPosition?.name?.trim()) && getUserDisplayTitle(user) === value)) return value;
  const labels = new Set(matched.map(user => ppeRole(value, { ...user, positionTitle: null, jobPosition: null }, copy)));
  return labels.size === 1 ? [...labels][0] : value;
}
export function ppeRecipient(row: PpeIssuanceRow, users: readonly User[], copy: (key: Role) => string) {
  const original = getPpeIssuanceRecipientLabel(row, [...users]);
  const user = users.find(item => item.id === row.recipientUserId);
  if (!user || user.positionTitle?.trim() || user.jobPosition?.name?.trim()) return original;
  const title = ppeRole("", user, copy), name = user.name || row.recipientName || "";
  if (original === name) return original;
  return title ? [title === name ? "" : title, name].filter(Boolean).join(", ") : original;
}
/** Raw source identity excludes all IDs allocated by a normalizer/factory. */
export function ppeSourceIdentity(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item) ?? "undefined";
}
/** Evaluate the route's original config read and normalizer exactly once. */
export function capturePpeSource<T>(source: unknown, normalize: (source: unknown) => T, identity: (source: unknown) => string | undefined) {
  const config = normalize(source);
  return { config, sourceIdentity: identity(source) };
}
export function capturePpeTitle(value: string | null | undefined, fallback: string) {
  return { title: value || fallback, titleIsFallback: !value };
}
export function ppeDocumentSourceIdentity(props: {
  documentId: string; title: string; titleIsFallback?: boolean; dateFrom: string; status: string;
  sourceIdentity?: string; config: unknown; users: readonly User[];
}) {
  return ppeSourceIdentity([props.documentId, props.title, props.titleIsFallback, props.dateFrom,
    props.status, props.sourceIdentity ?? props.config, props.users]);
}
export type PpeErrorKey =
  | "saveDocumentFailed" | "saveSettingsFailed" | "saveRowFailed"
  | "deleteRowsFailed" | "error" | "networkError" | "closeDocument.failed";
export type PpeErrorCopy = (key: PpeErrorKey) => string;
const errorKeys = new WeakMap<Error, PpeErrorKey>();
export function tagPpeError<T extends Error>(error: T, key: PpeErrorKey): T {
  errorKeys.set(error, key);
  return error;
}
export function presentPpeError(error: unknown, fallback: PpeErrorKey, copy: PpeErrorCopy) {
  const key = error instanceof Error ? errorKeys.get(error) : undefined;
  return key ? copy(key) : humanizeFetchError(error, copy(fallback), copy("networkError"));
}

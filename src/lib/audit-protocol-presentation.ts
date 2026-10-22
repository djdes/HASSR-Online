/** Locale-free display provenance. No business normalization or Error mutation. */
export function captureAuditProtocolTitle<T>(value: T, fallback: () => string) {
  return { title: value || fallback(), displayTitleMissing: !value };
}

export function presentAuditProtocolTitle<T>(value: T, missing: boolean | undefined, standard: string): T | string {
  return !value || missing ? standard : value;
}

/** Capture before normalization without reading fields/getters or copying data. */
export function captureAuditProtocolConfig<T, R>(
  value: T,
  normalize: (value: T) => R,
  sourceIdentity?: (value: T) => string | undefined,
) {
  const rawConfig = value;
  const config = normalize(rawConfig);
  const displayConfigMissing = !rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig);
  // Optional server-only identity runs after the original normalizer and never enters writes.
  const configSourceIdentity = sourceIdentity?.(rawConfig);
  return { config, displayConfigMissing, ...(configSourceIdentity === undefined ? {} : { configSourceIdentity }) };
}

/** Keep the original template interpolation's string-hint coercion. */
export function auditProtocolText(value: unknown): string {
  return `${value}`;
}

/** Per-instance identity only. Unknown Errors and their getters remain untouched. */
export function createAuditProtocolFailureRegistry() {
  const owned = new WeakSet<object>();
  return {
    mark(error: object) { owned.add(error); },
    has(error: unknown) { return typeof error === "object" && error !== null && owned.has(error); },
  };
}

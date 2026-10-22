/** Presentation provenance only. Business values and Error objects remain raw. */
export function captureAuditReportTitle<T>(value: T, fallback: () => string) {
  return { title: value || fallback(), displayTitleMissing: !value };
}

export function presentAuditReportTitle<T>(value: T, missing: boolean | undefined, standard: string): T | string {
  return !value || missing ? standard : value;
}

/** Preserve the original template interpolation's default-hint coercion. */
export function auditReportText(value: unknown): string {
  return `${value}`;
}

/** Locale-free and instance-owned; never inspects an Error's properties. */
export function createAuditReportFailureRegistry() {
  const owned = new WeakSet<object>();
  return {
    mark(error: object) { owned.add(error); },
    has(error: unknown) { return typeof error === "object" && error !== null && owned.has(error); },
  };
}

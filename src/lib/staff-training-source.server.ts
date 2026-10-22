import "server-only";

/** Preserve the original normalizer and native failure before observing source. */
export function captureStaffTrainingSource<T>(source: unknown, normalize: (source: unknown) => T, identity: (source: unknown) => string | undefined): { initialConfig: T; sourceIdentity?: string } {
  const initialConfig = normalize(source);
  return { initialConfig, sourceIdentity: identity(source) };
}

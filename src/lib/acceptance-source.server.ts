import "server-only";

/** Run the original normalizer before observing source, preserving native failure and object identity. */
export function captureAcceptanceSource<T>(
  source: unknown,
  normalize: (source: unknown) => T,
  identity: (source: unknown) => string | undefined,
): { config: T; sourceIdentity?: string } {
  const config = normalize(source);
  return { config, sourceIdentity: identity(source) };
}

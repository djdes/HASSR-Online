/** Presentation provenance only. Stored values never depend on interface language. */
export function presentMaintenanceValue(value: string, missing: boolean | undefined, fallback: string): string {
  return !value || missing ? fallback : value;
}

/** Only original source presence can distinguish injected defaults from stored text. */
export function maintenanceSourceHas(source: unknown, field: string): boolean {
  return Boolean(source && typeof source === "object" && !Array.isArray(source) && Object.hasOwn(source, field));
}

/** Match the native trimmed role fallback; uncertain descriptors remain stored text. */
export function maintenanceRoleUsesFactory(source: unknown, field: "approveRole" | "responsibleRole"): boolean {
  if (!source || typeof source !== "object" || Array.isArray(source)) return true;
  try {
    const prototype = Object.getPrototypeOf(source);
    if (prototype !== null && prototype !== Object.prototype) return false;
    const descriptor = Object.getOwnPropertyDescriptor(source, field);
    if (!descriptor) return true;
    if (!("value" in descriptor)) return false;
    return typeof descriptor.value !== "string" || !descriptor.value.trim();
  } catch { return false; }
}

/** Match template interpolation's coercion without localizing business values. */
export function maintenanceText(value: unknown): string {
  return `${value}`;
}

type MaintenanceFailureKey = "saveFailed" | "settingsFailed";

/** Per mounted editor; identical server-authored errors are never reclassified. */
export function createMaintenanceFailureRegistry() {
  const owned = new WeakMap<object, MaintenanceFailureKey>();
  return {
    mark(error: object, key: MaintenanceFailureKey) { owned.set(error, key); },
    key(error: unknown) {
      return typeof error === "object" && error !== null ? owned.get(error) : undefined;
    },
  };
}

/** Keep the original raw read/normalizer evaluation together, before subsequent JSX props. */
export function captureMaintenanceSource<T>(source: unknown, normalize: (source: unknown) => T) {
  const initialConfig = normalize(source);
  return { initialConfig, sourceConfig: source };
}

/** Raw source excludes IDs allocated by fallback factories; undefined retains legacy callers. */
export function maintenanceServerSourceIdentity(initialConfig: unknown, sourceConfig?: unknown): string | undefined {
  if (sourceConfig === undefined) return JSON.stringify(initialConfig);
  return JSON.stringify(sourceConfig, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}

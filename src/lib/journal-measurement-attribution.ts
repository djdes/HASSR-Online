/** Metadata and assigned defaults are not a recorded measurement. Zero is. */
export function hasRecordedMeasurements(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  const hasValue = (value: unknown): boolean => {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") return value.trim() !== "";
    if (value && typeof value === "object") return Object.values(value).some(hasValue);
    return false;
  };
  return [record.measurements, record.temperatures, record.statuses].some(hasValue);
}

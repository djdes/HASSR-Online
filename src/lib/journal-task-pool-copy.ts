import type { useTranslations } from "next-intl";

export const POOL_EVENT_CODES = ["accident_journal", "complaint_register", "breakdown_history", "ppe_issuance", "glass_items_list", "metal_impurity", "perishable_rejection", "product_writeoff", "traceability_test", "general_cleaning", "sanitation_day_control", "sanitary_day_control", "pest_control", "intensive_cooling", "glass_control", "audit_plan", "audit_protocol", "audit_report", "training_plan"] as const;
type EventCode = typeof POOL_EVENT_CODES[number];
type StaticKey = "hygieneShift" | "healthShift" | "climateHint" | "incoming" | "incomingHint" | "disinfectant" | "disinfectantHint" | "fryerDefault" | "uvDefault" | "maintenance" | "calibration" | "equipmentCleaning" | `event_${EventCode}`;
export type PoolCopy = { key: StaticKey }
  | { key: "coldShift" | "climateShift"; params: { name: string; shift: "morning" | "evening" } }
  | { key: "meal"; params: { meal: "breakfast" | "lunch" | "dinner" } }
  | { key: "fryer" | "cleaning" | "uv"; params: { name: string } }
  | { key: "equipmentCount"; params: { count: number } };
export type PoolDisplayCopy = { version: 1; scopeLabel?: PoolCopy; sublabel?: PoolCopy };

/** Created at the source branch; never infer a descriptor from a saved label or key. */
export function poolDisplayCopy(enabled: unknown, scopeLabel?: PoolCopy, sublabel?: PoolCopy): { displayCopy?: PoolDisplayCopy } {
  return enabled === true ? { displayCopy: { version: 1, ...(scopeLabel ? { scopeLabel } : {}), ...(sublabel ? { sublabel } : {}) } } : {};
}

export function poolEventCopy(code: string): PoolCopy | undefined {
  return (POOL_EVENT_CODES as readonly string[]).includes(code) ? { key: `event_${code as EventCode}` } : undefined;
}

/** The today API's existing journal-label replacement takes precedence. */
export function omitPoolSublabel(copy: PoolDisplayCopy | undefined): PoolDisplayCopy | undefined {
  return copy ? { version: 1, ...(copy.scopeLabel ? { scopeLabel: copy.scopeLabel } : {}) } : undefined;
}

const RULES = {
  hygieneShift: ["scopeLabel", "hygiene"], healthShift: ["scopeLabel", "health_check"],
  coldShift: ["scopeLabel", "cold_equipment_control"], climateShift: ["scopeLabel", "climate_control"],
  climateHint: ["sublabel", "climate_control"], incoming: ["scopeLabel", "incoming_control"], incomingHint: ["sublabel", "incoming_control"],
  meal: ["scopeLabel", "finished_product"], disinfectant: ["scopeLabel", "disinfectant_usage"], disinfectantHint: ["sublabel", "disinfectant_usage"],
  fryer: ["scopeLabel", "fryer_oil"], fryerDefault: ["scopeLabel", "fryer_oil"], cleaning: ["scopeLabel", "cleaning"],
  uv: ["scopeLabel", "uv_lamp_runtime"], uvDefault: ["scopeLabel", "uv_lamp_runtime"],
  maintenance: ["scopeLabel", "equipment_maintenance"], calibration: ["scopeLabel", "equipment_calibration"], equipmentCleaning: ["scopeLabel", "equipment_cleaning"],
  equipmentCount: ["sublabel", "equipment_maintenance", "equipment_calibration", "equipment_cleaning"],
} as const;
function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }

export function presentPoolCopy(t: ReturnType<typeof useTranslations<"miniTaskPool">>, copy: unknown, code: string, slot: "scopeLabel" | "sublabel", original: string): string {
  const envelope = object(copy);
  if (!envelope || !Object.hasOwn(envelope, "version") || envelope.version !== 1 || !Object.hasOwn(envelope, slot)) return original;
  const descriptor = object(envelope[slot]);
  if (!descriptor || !Object.hasOwn(descriptor, "key") || typeof descriptor.key !== "string") return original;
  const key = descriptor.key;
  if ((POOL_EVENT_CODES as readonly string[]).includes(code) && key === `event_${code}`) {
    return slot === "scopeLabel" && exactKeys(descriptor, ["key"]) ? t(key as `event_${EventCode}`) : original;
  }
  if (!Object.hasOwn(RULES, key)) return original;
  const rule = RULES[key as keyof typeof RULES] as readonly string[];
  if (rule[0] !== slot || !rule.slice(1).includes(code)) return original;
  const params = object(descriptor.params);
  if (key === "coldShift" || key === "climateShift") {
    if (!exactKeys(descriptor, ["key", "params"]) || !params || !exactKeys(params, ["name", "shift"]) || typeof params.name !== "string" || (params.shift !== "morning" && params.shift !== "evening")) return original;
    return t(key, { name: params.name, shift: params.shift });
  }
  if (key === "meal") {
    if (!exactKeys(descriptor, ["key", "params"]) || !params || !exactKeys(params, ["meal"]) || typeof params.meal !== "string" || !["breakfast", "lunch", "dinner"].includes(params.meal)) return original;
    return t(key, { meal: params.meal });
  }
  if (key === "fryer" || key === "cleaning" || key === "uv") {
    if (!exactKeys(descriptor, ["key", "params"]) || !params || !exactKeys(params, ["name"]) || typeof params.name !== "string") return original;
    return t(key, { name: params.name });
  }
  if (key === "equipmentCount") {
    if (!exactKeys(descriptor, ["key", "params"]) || !params || !exactKeys(params, ["count"]) || typeof params.count !== "number" || !Number.isSafeInteger(params.count) || params.count < 0) return original;
    return t(key, { count: params.count });
  }
  return exactKeys(descriptor, ["key"]) ? t(key as Exclude<StaticKey, `event_${EventCode}`>) : original;
}

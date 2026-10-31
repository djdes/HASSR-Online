/**
 * Registry of journals that integrate with TasksFlow.
 *
 * Two layers:
 *   1. **Specific adapters** (`SPECIFIC_ADAPTERS` array) — hand-rolled
 *      for journals where the data shape allows precise column mapping
 *      (cleaning matrix, hygiene status+temp, climate readings, etc.).
 *      These give the best UX: structured form → exact cell fill.
 *   2. **Generic fallback** (`buildGenericAdapter`) — auto-built for
 *      every other active journal in the org. Free-text comment +
 *      «Готово» button → JournalDocumentEntry with audit metadata.
 *
 * All 35 active journals get an adapter — specific ones win, the rest
 * fall back to generic.
 *
 * Adding a specific adapter: write the file, push it into
 * `SPECIFIC_ADAPTERS`, done. The generic fallback automatically stops
 * applying to that templateCode.
 */
import { db } from "@/lib/db";
import { cleaningAdapter } from "./cleaning";
import { hygieneAdapter } from "./hygiene";
import { healthCheckAdapter } from "./health-check";
import { coldEquipmentAdapter } from "./cold-equipment";
import { cleaningVentilationChecklistAdapter } from "./cleaning-ventilation-checklist";
import { uvLampRuntimeAdapter } from "./uv-lamp-runtime";
import { pestControlAdapter } from "./pest-control";
import { intensiveCoolingAdapter } from "./intensive-cooling";
import { equipmentCleaningAdapter } from "./equipment-cleaning";
import { finishedProductAdapter } from "./finished-product";
import { climateAdapter } from "./climate";
import { perishableRejectionAdapter } from "./perishable-rejection";
import { sanitationDayAdapter } from "./sanitation-day";
import { equipmentMaintenanceAdapter } from "./equipment-maintenance";
import { productWriteoffAdapter } from "./product-writeoff";
import { equipmentCalibrationAdapter } from "./equipment-calibration";
import { breakdownHistoryAdapter } from "./breakdown-history";
import { accidentJournalAdapter } from "./accident-journal";
import { acceptanceAdapter, rawMaterialAcceptanceAdapter } from "./acceptance";
import { metalImpurityAdapter } from "./metal-impurity";
import { ppeIssuanceAdapter } from "./ppe-issuance";
import { disinfectantUsageAdapter } from "./disinfectant-usage";
import { glassListAdapter } from "./glass-list";
import { glassControlAdapter } from "./glass-control";
import { staffTrainingAdapter } from "./staff-training";
import { trainingPlanAdapter } from "./training-plan";
import { auditPlanAdapter } from "./audit-plan";
import { auditProtocolAdapter } from "./audit-protocol";
import { auditReportAdapter } from "./audit-report";
import { traceabilityAdapter } from "./traceability";
import { complaintRegisterAdapter } from "./complaint-register";
import { buildGenericAdapter } from "./generic";
import { withPointRows } from "./point-rows";
import type { JournalAdapter } from "./types";

/**
 * In-memory registry of specific adapters. Exposed для контрактных
 * тестов (см. src/domain/journal/adapter-contract.test.ts) — позволяет
 * проверить контракт без обращения к БД.
 *
 * Generic adapters (для journals без specific) тестируются отдельно
 * через buildGenericAdapter.
 */
export const SPECIFIC_ADAPTERS: JournalAdapter[] = [
  cleaningAdapter,
  hygieneAdapter,
  healthCheckAdapter,
  coldEquipmentAdapter,
  cleaningVentilationChecklistAdapter,
  uvLampRuntimeAdapter,
  pestControlAdapter,
  intensiveCoolingAdapter,
  equipmentCleaningAdapter,
  finishedProductAdapter,
  climateAdapter,
  perishableRejectionAdapter,
  sanitationDayAdapter,
  equipmentMaintenanceAdapter,
  productWriteoffAdapter,
  equipmentCalibrationAdapter,
  breakdownHistoryAdapter,
  accidentJournalAdapter,
  acceptanceAdapter,
  rawMaterialAcceptanceAdapter,
  metalImpurityAdapter,
  ppeIssuanceAdapter,
  disinfectantUsageAdapter,
  glassListAdapter,
  glassControlAdapter,
  staffTrainingAdapter,
  trainingPlanAdapter,
  auditPlanAdapter,
  auditProtocolAdapter,
  auditReportAdapter,
  traceabilityAdapter,
  complaintRegisterAdapter,
];

const SPECIFIC_BY_CODE = new Map<string, JournalAdapter>(
  SPECIFIC_ADAPTERS.map((a) => [a.meta.templateCode, a])
);

/**
 * In-memory cache of generic adapters per templateCode. Generic
 * adapters are stateless — building once is enough. Cleared on
 * server restart (per-process).
 */
const GENERIC_CACHE = new Map<string, JournalAdapter>();

/**
 * Cached active templates list. We refresh once per minute so a new
 * template appearing in DB doesn't require a server restart, but we
 * don't hammer the DB on every request.
 */
let templatesCache: { ts: number; rows: { code: string; name: string }[] } | null = null;
const TEMPLATES_TTL_MS = 60_000;

async function getActiveTemplates() {
  if (templatesCache && Date.now() - templatesCache.ts < TEMPLATES_TTL_MS) {
    return templatesCache.rows;
  }
  const rows = await db.journalTemplate.findMany({
    where: { isActive: true },
    select: { code: true, name: true },
    orderBy: { sortOrder: "asc" },
  });
  templatesCache = { ts: Date.now(), rows };
  return rows;
}

export async function listAdapters(): Promise<JournalAdapter[]> {
  const templates = await getActiveTemplates();
  const out: JournalAdapter[] = [];
  for (const tpl of templates) {
    const specific = SPECIFIC_BY_CODE.get(tpl.code);
    if (specific) {
      out.push(withPointRows(specific));
      continue;
    }
    let generic = GENERIC_CACHE.get(tpl.code);
    if (!generic) {
      generic = buildGenericAdapter(tpl.code, tpl.name);
      GENERIC_CACHE.set(tpl.code, generic);
    }
    out.push(withPointRows(generic));
  }
  // Строки документа точки — только её сотрудники (см. point-rows.ts).
  return out;
}

/**
 * Synchronous variant — for hot paths (PATCH hook, webhook receiver)
 * that already have a templateCode in hand and don't want to await
 * a DB call. Returns a specific adapter if registered; otherwise
 * builds (and caches) a generic with a placeholder label.
 *
 * The placeholder label is only shown if the generic was built before
 * the template list cache populated — once `listAdapters()` runs once,
 * subsequent calls swap to the named generic.
 */
export function getAdapter(templateCode: string | null | undefined): JournalAdapter | null {
  if (!templateCode) return null;
  const specific = SPECIFIC_BY_CODE.get(templateCode);
  if (specific) return withPointRows(specific);
  let generic = GENERIC_CACHE.get(templateCode);
  if (!generic) {
    // Use templateCode as label fallback; listAdapters() will replace
    // with the proper journal name on next catalog request.
    generic = buildGenericAdapter(templateCode, templateCode);
    GENERIC_CACHE.set(templateCode, generic);
  }
  return withPointRows(generic);
}

export function isJournalSupported(templateCode: string | null | undefined): boolean {
  // Every active journal is supported now (specific or generic
  // fallback). Returning true unconditionally for non-empty code.
  return Boolean(templateCode);
}

export type {
  JournalAdapter,
  JournalSyncReport,
  AdapterDocument,
  AdapterRow,
} from "./types";

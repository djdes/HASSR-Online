/** AC5 на базе: какие журналы каталога включены у новых организаций. */
import fs from "node:fs";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { STANDARD_JOURNAL_CODES } from "@/lib/journal-sets";
const state = JSON.parse(fs.readFileSync(".agent/tasks/journal-sets-checklists-2026-10/raw/e2e-state.json", "utf8"));
const out: Record<string, unknown> = {};
for (const org of state.orgs) {
  const disabled = new Set<string>(org.disabledJournalCodes);
  const enabled = ACTIVE_JOURNAL_CATALOG.map((i) => i.code).filter((c) => !disabled.has(c));
  out[org.name] = {
    sphere: org.type,
    enabledCount: enabled.length,
    enabled,
    standardAllEnabled: STANDARD_JOURNAL_CODES.every((c) => !disabled.has(c)),
    healthCheckDisabled: disabled.has("health_check"),
    ccpMonitoringDisabled: disabled.has("ccp_monitoring"),
  };
}
fs.writeFileSync(".agent/tasks/journal-sets-checklists-2026-10/raw/db-new-org-defaults.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));

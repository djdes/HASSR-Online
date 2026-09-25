/* eslint-disable no-console */
// Было / стало для AC3: старый источник списка (`listHubJournals`) против
// нового (`planQrOverview` по включённым журналам) на e2e-организации.
//   npx tsx --env-file=.env .agent/tasks/cabinet-nav-dashboard-2026-09/e2e/probe-qr-list.ts
import { db } from "@/lib/db";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { JOURNAL_FILL_HUB_CODE, listHubJournals, todayKeyFor } from "@/lib/journal-fill";
import { planQrOverview } from "@/lib/qr-posters-overview";

const ORG_ID = process.env.E2E_ORG ?? "e2e-nav-dashboard-org";

async function main() {
  const org = await db.organization.findUnique({ where: { id: ORG_ID }, select: { disabledJournalCodes: true, timezone: true } });
  const disabled = parseDisabledCodes(org?.disabledJournalCodes);
  const before = await listHubJournals(ORG_ID, Array.from(disabled), todayKeyFor(org?.timezone), { includeLapsed: true });
  const templates = await db.journalTemplate.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true } });
  const plan = planQrOverview(templates, disabled, JOURNAL_FILL_HUB_CODE);
  console.log(JSON.stringify({
    before: { count: before.length, codes: before.map((j) => j.code), hasHygiene: before.some((j) => j.code === "hygiene") },
    after: {
      journals: plan.journals.length,
      objectJournals: plan.objectJournals.map((j) => j.code),
      hasHygiene: plan.journals.some((j) => j.code === "hygiene"),
      hygieneVerify: plan.hygieneVerify,
      enabledTemplates: templates.length,
    },
  }, null, 2));
}

main().finally(() => db.$disconnect());

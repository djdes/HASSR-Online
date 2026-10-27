/**
 * Задача 3, проверка на e2e-базе (НЕ прод): правило для организаций без
 * сохранённого выбора спецрежима, запись решения и guard API.
 *
 * DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable \
 *   npx tsx .agent/tasks/sidebar-points-special-2026-10/e2e/task3-controls-runtime.ts
 */
import { db } from "@/lib/db";
import { getJournalControls, rejectJournalAutomation, updateJournalControls } from "@/lib/journal-controls.server";
import { AUTOMATION_ALL_ON, AUTOMATION_OFF } from "@/lib/journal-controls";

if (!/localhost:5432\/wesetup_e2e/.test(process.env.DATABASE_URL ?? "")) throw new Error("only the e2e database");

const tag = `t3-${Date.now()}`;
const before = new Date("2026-10-01T00:00:00+03:00");
const after = new Date("2026-10-29T00:00:00+03:00");
const cases = [
  { name: "old org with hygiene automation", createdAt: before, journalAutomationJson: { hygiene: { autoCreate: true, autoFill: true } }, autoJournalCodes: [], stored: null, expected: AUTOMATION_ALL_ON },
  { name: "old org with legacy autoJournalCodes", createdAt: before, journalAutomationJson: {}, autoJournalCodes: ["cleaning"], stored: null, expected: AUTOMATION_ALL_ON },
  { name: "old org, automation never used", createdAt: before, journalAutomationJson: {}, autoJournalCodes: [], stored: null, expected: AUTOMATION_OFF },
  { name: "old org with old specialMode=true", createdAt: before, journalAutomationJson: { hygiene: { autoCreate: true, autoFill: true } }, autoJournalCodes: [], stored: { specialMode: true, sensorCamera: { cold_equipment_control: true } }, expected: AUTOMATION_OFF },
  { name: "new org after the cut-off", createdAt: after, journalAutomationJson: { hygiene: { autoCreate: true, autoFill: true } }, autoJournalCodes: [], stored: null, expected: AUTOMATION_OFF },
];

async function main() {
const results: unknown[] = [];
const ids: string[] = [];
try {
  for (const item of cases) {
    // Raw insert: the shared Prisma client may be generated from a newer schema
    // than the e2e database (columns from other branches).
    const org = { id: `${tag}-${ids.length}` };
    await db.$executeRaw`INSERT INTO "Organization" ("id", "name", "type", "createdAt", "updatedAt", "journalAutomationJson", "autoJournalCodes")
      VALUES (${org.id}, ${`${tag} ${item.name}`}, 'restaurant', ${item.createdAt}, now(), ${JSON.stringify(item.journalAutomationJson)}::jsonb, ${JSON.stringify(item.autoJournalCodes)}::jsonb)`;
    ids.push(org.id);
    if (item.stored) await db.platformSetting.create({ data: { key: `org-journal-controls:${org.id}`, value: JSON.stringify(item.stored) } });
    const controls = await getJournalControls(org.id);
    const row = await db.platformSetting.findUnique({ where: { key: `org-journal-controls:${org.id}` } });
    const persisted = JSON.parse(String(row?.value));
    const blocked = await rejectJournalAutomation(org.id, "autoFill");
    const ok = JSON.stringify(controls.automation) === JSON.stringify(item.expected) &&
      JSON.stringify(persisted.automation) === JSON.stringify(item.expected) && !("specialMode" in persisted) &&
      (item.expected.enabled ? blocked === null : blocked?.status === 403);
    results.push({ case: item.name, automation: controls.automation, persisted, guard: blocked ? blocked.status : "allowed", ok });
  }
  // Explicit choice wins over the rule and survives unrelated patches.
  const target = ids[0];
  await updateJournalControls(target, { automation: { enabled: true, autoFill: false, autoCreate: true, copyYesterday: false, closeDayAutofill: true } });
  await updateJournalControls(target, { sensorCamera: { climate_control: true } });
  const after2 = await getJournalControls(target);
  const blockedFill = await rejectJournalAutomation(target, "autoFill");
  const blockedBody = blockedFill ? await blockedFill.json() : null;
  results.push({
    case: "explicit choice wins, camera patch keeps it, guard names the feature",
    automation: after2.automation,
    camera: after2.sensorCamera,
    guard: blockedFill?.status,
    body: blockedBody,
    ok: after2.automation.autoCreate && !after2.automation.autoFill && after2.sensorCamera.climate_control === true &&
      blockedFill?.status === 403 && blockedBody?.code === "special_mode" && (await rejectJournalAutomation(target, "autoCreate")) === null,
  });
} finally {
  await db.platformSetting.deleteMany({ where: { key: { in: ids.map((id) => `org-journal-controls:${id}`) } } });
  for (const id of ids) await db.$executeRaw`DELETE FROM "Organization" WHERE "id" = ${id}`;
}
console.log(JSON.stringify(results, null, 2));
const failed = results.filter((item) => !(item as { ok: boolean }).ok);
console.log(failed.length === 0 ? "PASS" : `FAIL ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
}

void main();

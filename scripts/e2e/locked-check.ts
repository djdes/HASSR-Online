// E2E copy of .agent/tasks/multi-org-followups-a-2026-11-20/raw/locked-check.ts (series A); the task copy stays as that series' evidence.
/*
 * Series A, AC1: `lockedOrganizationIds` and the daily job that creates journal documents.
 * One paid account with one point: an organization in the tariff and an organization whose
 * own 14 days ended two days ago (locked). Both have the same journals and automation on;
 * the cron creates documents for the open one only.
 */
import "./env";

import { db } from "@/lib/db";
import { AUTOMATION_ALL_ON } from "@/lib/journal-controls";
import { updateJournalControls } from "@/lib/journal-controls.server";
import { isOrganizationLocked, lockedOrganizationIds } from "@/lib/org-trial.server";

const TAG = `lockchk${Date.now().toString(36)}`;
const DAY = 86_400_000;
const orgIds: string[] = [];
const accountIds: string[] = [];
let failed = 0;
let passed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
}

async function main() {
  const now = new Date();
  const open = await db.organization.create({
    data: { name: `Открытая ${TAG}`, type: "restaurant", autoJournalCodes: ["hygiene"], createdAt: new Date(now.getTime() - 40 * DAY) },
  });
  orgIds.push(open.id);
  const owner = await db.user.create({
    data: { email: `${TAG}@example.test`, name: "Владелец", passwordHash: "x", role: "manager", organizationId: open.id },
  });
  const account = await db.account.create({
    data: {
      ownerUserId: owner.id,
      subscriptionPlan: "standard",
      subscriptionEnd: new Date(now.getTime() + 30 * DAY),
      planPoints: 1,
      planCycle: "month",
      createdAt: new Date(now.getTime() - 40 * DAY),
    },
  });
  accountIds.push(account.id);
  await db.organization.update({ where: { id: open.id }, data: { accountId: account.id } });
  const closed = await db.organization.create({
    data: {
      name: `Закрытая ${TAG}`,
      type: "restaurant",
      accountId: account.id,
      autoJournalCodes: ["hygiene"],
      createdAt: new Date(now.getTime() - 16 * DAY),
      trialEndsAt: new Date(now.getTime() - 2 * DAY),
    },
  });
  orgIds.push(closed.id);
  for (const id of [open.id, closed.id]) await updateJournalControls(id, { automation: { ...AUTOMATION_ALL_ON } });

  const locked = await lockedOrganizationIds(now);
  check("lockedOrganizationIds returns the organization whose own 14 days ended", locked.has(closed.id), [...locked]);
  check("lockedOrganizationIds does not return the organization in the tariff", !locked.has(open.id));
  check("agrees with isOrganizationLocked", (await isOrganizationLocked(closed.id, now)) && !(await isOrganizationLocked(open.id, now)));

  process.env.CRON_SECRET = process.env.CRON_SECRET || `secret-${TAG}`;
  const { GET } = await import("@/app/api/cron/auto-create-journals/route");
  const response = await GET(new Request(`http://localhost/api/cron/auto-create-journals?secret=${encodeURIComponent(process.env.CRON_SECRET)}`));
  check("auto-create-journals answers 200", response.status === 200, response.status);
  const documents = async (organizationId: string) => db.journalDocument.count({ where: { organizationId } });
  const openDocs = await documents(open.id);
  const closedDocs = await documents(closed.id);
  console.log(`documents: open organization ${openDocs}, locked organization ${closedDocs}`);
  check("open organization got journal documents", openDocs > 0, openDocs);
  check("locked organization got none", closedDocs === 0, closedDocs);
}

async function cleanup() {
  await db.platformSetting.deleteMany({ where: { OR: orgIds.map((id) => ({ key: { contains: id } })) } });
  for (const id of [...orgIds].reverse()) await db.organization.delete({ where: { id } }).catch(() => undefined);
  await db.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
  await db.user.deleteMany({ where: { email: { contains: TAG } } }).catch(() => undefined);
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  console.log(`cleanup: organizations left ${left}`);
}

main()
  .catch((error) => {
    failed += 1;
    console.error("FAIL script crashed", error);
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    console.log(`TOTAL: ${passed} PASS, ${failed} FAIL`);
    await db.$disconnect();
    process.exit(failed === 0 ? 0 : 1);
  });

/**
 * Proof run for the shared demo organization (task
 * shared-demo-point-mismatch-2026-11-09). Needs a seeded local database.
 * Usage: npx tsx scripts/_verify-shared-demo.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import {
  ensureSharedDemoOrganization,
  joinSharedDemoOrganization,
  purgeLegacyDemoOrganizations,
  reinstallSharedDemoOrganization,
} from "@/lib/demo-organization";
import { SHARED_DEMO_ORG_ID } from "@/lib/demo-organization.shared";
import { assertOrgMembership, listAccessibleOrganizations } from "@/lib/organization-access";

async function owner(tag: string) {
  const org = await db.organization.create({ data: { name: `Кафе ${tag}`, type: "restaurant" }, select: { id: true } });
  const user = await db.user.create({
    data: { organizationId: org.id, name: `Владелец ${tag}`, email: `verify-${tag}-${Date.now()}@example.test`, passwordHash: "", role: "owner" },
    select: { id: true },
  });
  const account = await db.account.create({ data: { ownerUserId: user.id }, select: { id: true } });
  await db.organization.update({ where: { id: org.id }, data: { accountId: account.id } });
  return { orgId: org.id, userId: user.id, accountId: account.id };
}

async function main() {
  // Start clean: leftovers of an earlier run and an installed demo.
  await db.organization.deleteMany({ where: { OR: [{ id: SHARED_DEMO_ORG_ID, isDemo: true }, { name: { in: ["Кафе a", "Кафе b", "Демо — старая"] } }] } });
  const a = await owner("a");
  const b = await owner("b");
  // Legacy per-account demo of owner A (old scheme).
  const legacy = await db.organization.create({
    data: { name: "Демо — старая", type: "restaurant", accountId: a.accountId, isDemo: true },
    select: { id: true },
  });
  const orgsBefore = await db.organization.count();

  const first = await ensureSharedDemoOrganization();
  assert.equal(first.organizationId, SHARED_DEMO_ORG_ID);
  assert.ok(first.installed, "first open installs the demo");
  console.log("installed", first.installed.seed, `${first.installed.durationMs} ms`);
  await joinSharedDemoOrganization(a.userId);

  const second = await ensureSharedDemoOrganization();
  assert.equal(second.organizationId, SHARED_DEMO_ORG_ID);
  assert.equal(second.installed, null, "a fresh demo is reused, not reinstalled");
  await joinSharedDemoOrganization(b.userId);

  // AC1: both owners are in the same organization; only one org was added.
  assert.equal(await assertOrgMembership(a.userId, SHARED_DEMO_ORG_ID), true);
  assert.equal(await assertOrgMembership(b.userId, SHARED_DEMO_ORG_ID), true);
  assert.equal(await db.organization.count(), orgsBefore + 1);
  assert.equal(await db.organization.count({ where: { isDemo: true, id: SHARED_DEMO_ORG_ID } }), 1);
  const listed = (await listAccessibleOrganizations(b.userId)).filter((o) => o.isDemo);
  assert.deepEqual(listed.map((o) => o.id), [SHARED_DEMO_ORG_ID]);

  // AC5: each roster person exists once.
  const sokolova = await db.user.count({ where: { name: "Соколова Ирина Владимировна" } });
  assert.equal(sokolova, 1);

  // AC3: legacy demo of account A goes away, real organizations stay.
  const purged = await purgeLegacyDemoOrganizations({ take: 20 });
  assert.deepEqual(purged.deleted.map((o) => o.id), [legacy.id]);
  assert.equal(await db.organization.count({ where: { id: { in: [a.orgId, b.orgId] } } }), 2);

  // AC2: a visitor's change disappears after the reinstall; id is the same.
  const doc = await db.journalDocument.findFirstOrThrow({ where: { organizationId: SHARED_DEMO_ORG_ID }, select: { id: true } });
  await db.journalDocument.update({ where: { id: doc.id }, data: { title: "Испорчено гостем" } });
  const again = await reinstallSharedDemoOrganization();
  assert.equal(again.organizationId, SHARED_DEMO_ORG_ID);
  assert.ok(again.removed && again.removed.staff > 0);
  assert.equal(await db.journalDocument.count({ where: { title: "Испорчено гостем" } }), 0);
  assert.equal(await db.user.count({ where: { name: "Соколова Ирина Владимировна" } }), 1);
  assert.equal(await assertOrgMembership(a.userId, SHARED_DEMO_ORG_ID), false, "visitors are sent home by the reinstall");
  console.log("reinstalled", again.seed, "removed", again.removed, `${again.durationMs} ms`);

  // AC2: an overdue demo is reinstalled when somebody opens it.
  await db.organization.update({ where: { id: SHARED_DEMO_ORG_ID }, data: { demoExpiresAt: new Date(Date.now() - 1000) } });
  const lazy = await ensureSharedDemoOrganization();
  assert.ok(lazy.installed, "overdue demo is reinstalled on open");
  const row = await db.organization.findUniqueOrThrow({ where: { id: SHARED_DEMO_ORG_ID }, select: { demoExpiresAt: true, accountId: true, isDemo: true } });
  assert.ok(row.isDemo && row.accountId === null && row.demoExpiresAt && row.demoExpiresAt.getTime() > Date.now());

  // Cleanup of the two test owners.
  await db.account.deleteMany({ where: { id: { in: [a.accountId, b.accountId] } } });
  await db.organization.deleteMany({ where: { id: { in: [a.orgId, b.orgId] } } });
  console.log("PASS shared demo");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

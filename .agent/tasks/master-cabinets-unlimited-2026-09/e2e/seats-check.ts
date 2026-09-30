// Места тарифа кабинета на ЛОКАЛЬНОЙ e2e-базе: без людей — 0, с человеком — +1 на каждый подключённый пищеблок,
// сам сотрудник группы «Мастер-кабинет» места не занимает. Всё созданное удаляется.
import assert from "node:assert/strict";
import { loadBillingUnit } from "@/lib/billing.server";
import { masterCabinetSeatsToAdd } from "@/lib/master-cabinet-seats";
import { ensureMasterCabinetPosition } from "@/lib/master-cabinet-staff";
import { db } from "../../mobile-apps-2026-09/e2e/server-db";

if (!/@localhost:5432\/wesetup_e2e\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("e2e db only");
const ORG_A = "e2e-org-a";
async function main() {
  const owner = await db.user.findFirstOrThrow({ where: { email: "manager-a@e2e.local" }, select: { id: true } });
  const orgA = await db.organization.findUniqueOrThrow({ where: { id: ORG_A }, select: { accountId: true, serviceCode: true, linkedServiceCode: true } });
  const account = await db.account.create({ data: { ownerUserId: owner.id }, select: { id: true } });
  await db.organization.update({ where: { id: ORG_A }, data: { accountId: account.id, linkedServiceCode: "E2EMC-SEATS" } });
  const org2 = await db.organization.create({ data: { name: "Сад (seats)", type: "education", accountId: account.id, linkedServiceCode: "E2EMC-SEATS" }, select: { id: true } });
  const cab = await db.organization.create({ data: { name: "Кабинет (seats)", type: "education", kind: "directory", serviceCode: "E2EMC-SEATS", accountId: account.id }, select: { id: true } });
  await db.organizationMember.create({ data: { userId: owner.id, organizationId: cab.id, role: "owner" } });
  const out: Record<string, unknown> = {};
  let staffId: string | null = null;
  try {
    const base = (await loadBillingUnit(ORG_A))!.activeUsers;
    out.toAddEmpty = await masterCabinetSeatsToAdd(cab.id);
    assert.equal(out.toAddEmpty, 2);
    const position = await ensureMasterCabinetPosition(ORG_A);
    const staff = await db.user.create({ data: { name: "Бэк-офис (seats)", email: "seats-mk@e2e.local", passwordHash: "", role: "cook", organizationId: ORG_A, jobPositionId: position.id, isActive: true }, select: { id: true } });
    staffId = staff.id;
    await db.organizationMember.create({ data: { userId: staff.id, organizationId: cab.id, role: "manager" } });
    out.delta = (await loadBillingUnit(ORG_A))!.activeUsers - base;
    assert.equal(out.delta, 2, "+1 в каждом из двух подключённых, сам сотрудник — 0");
    out.toAddStaffed = await masterCabinetSeatsToAdd(cab.id);
    assert.equal(out.toAddStaffed, 0);
    await db.organization.update({ where: { id: org2.id }, data: { linkedServiceCode: null } });
    out.deltaAfterDisconnect = (await loadBillingUnit(ORG_A))!.activeUsers - base;
    assert.equal(out.deltaAfterDisconnect, 1);
    out.ok = true;
  } finally {
    if (staffId) { await db.organizationMember.deleteMany({ where: { userId: staffId } }); await db.user.delete({ where: { id: staffId } }); }
    await db.organizationMember.deleteMany({ where: { organizationId: cab.id } });
    await db.organization.deleteMany({ where: { id: { in: [cab.id, org2.id] } } });
    await db.jobPosition.deleteMany({ where: { organizationId: ORG_A, name: "Мастер-кабинет", users: { none: {} } } });
    await db.organization.update({ where: { id: ORG_A }, data: { accountId: orgA.accountId, serviceCode: orgA.serviceCode, linkedServiceCode: orgA.linkedServiceCode } });
    await db.account.delete({ where: { id: account.id } });
    console.log(JSON.stringify(out));
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

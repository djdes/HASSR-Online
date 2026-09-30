// Приглашённый закреплён за кабинетом (ЛОКАЛЬНАЯ e2e-база): домашняя организация — кабинет, «Убрать» — архив.
import assert from "node:assert/strict";
import { inviteToCabinet, listAccountCabinetsAccess, revokeCabinetAccess } from "@/lib/master-cabinet-access";
import { db } from "../../mobile-apps-2026-09/e2e/server-db";

if (!/@localhost:5432\/wesetup_e2e\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("e2e db only");
const EMAIL = "attached-mk@e2e.local";
async function main() {
  const owner = await db.user.findFirstOrThrow({ where: { email: "manager-a@e2e.local" }, select: { id: true } });
  const account = await db.account.create({ data: { ownerUserId: owner.id }, select: { id: true } });
  const cab = await db.organization.create({ data: { name: "Кабинет (attached)", type: "education", kind: "directory", serviceCode: "E2EMC-ATTAC", accountId: account.id }, select: { id: true } });
  const out: Record<string, unknown> = {};
  let checked: string[] = [];
  try {
    const invite = await inviteToCabinet({ ownerUserId: owner.id, cabinetId: cab.id, name: "Закреплённый За Кабинетом", email: EMAIL, beforeCreate: async (id) => { checked.push(id); } });
    const user = await db.user.findUniqueOrThrow({ where: { id: invite.user.id }, select: { organizationId: true, isActive: true, jobPositionId: true } });
    out.user = { homeIsCabinet: user.organizationId === cab.id, pending: !user.isActive, noGroup: user.jobPositionId === null, seatCheckOn: checked[0] === cab.id };
    assert.deepEqual(out.user, { homeIsCabinet: true, pending: true, noGroup: true, seatCheckOn: true });
    const access = await listAccountCabinetsAccess(owner.id);
    out.listed = access.cabinets[0]?.people.map((p) => `${p.kind}:${p.pending}`);
    assert.deepEqual(out.listed, ["invited:true"]);
    await assert.rejects(inviteToCabinet({ ownerUserId: owner.id, cabinetId: cab.id, name: "Повар", email: "cook-a@e2e.local" }), /Дать доступ сотруднику/);
    const again = await inviteToCabinet({ ownerUserId: owner.id, cabinetId: cab.id, name: "Закреплённый За Кабинетом", email: EMAIL });
    out.reinvited = again.reinvited;
    const revoked = await revokeCabinetAccess({ ownerUserId: owner.id, cabinetId: cab.id, userId: invite.user.id });
    out.revoked = revoked.archived;
    assert.equal(revoked.archived, true);
    out.ok = true;
  } finally {
    const u = await db.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
    if (u) { await db.inviteToken.deleteMany({ where: { userId: u.id } }); await db.user.delete({ where: { id: u.id } }); }
    await db.organizationMember.deleteMany({ where: { organizationId: cab.id } });
    await db.organization.delete({ where: { id: cab.id } });
    await db.account.delete({ where: { id: account.id } });
    console.log(JSON.stringify(out));
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

import { db, state } from "../tg-session";
(async () => {
  const us = await db.user.findMany({ where: { organizationId: "e2e-org-a" }, select: { id: true, name: true, email: true, role: true, permissionPreset: true } });
  console.log("USERS-A", JSON.stringify(us, null, 1));
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });
  console.log("ORGS", JSON.stringify(orgs));
  console.log("STATE", JSON.stringify(state.users));
  await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 500)); process.exit(1); });

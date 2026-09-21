import { db, state } from "../tg-session";
(async () => {
  const u = await db.user.findUnique({ where: { id: state.users.cookA.id }, select: { role: true, permissionPreset: true, journalAccessMigrated: true, permissionsJson: true, jobPosition: { select: { name: true, permissionsJson: true } } } });
  console.log("повар:", JSON.stringify(u));
  const acl = await db.userJournalAccess.findMany({ where: { userId: state.users.cookA.id } });
  console.log("строк доступа:", acl.length, JSON.stringify(acl.map(a=>a.journalCode)));
  const h = await db.user.findUnique({ where: { id: state.users.headA.id }, select: { role: true, permissionPreset: true, permissionsJson: true, jobPosition: { select: { name: true, permissionsJson: true } } } });
  console.log("заведующая:", JSON.stringify(h));
  await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,600));process.exit(1);});

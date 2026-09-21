import { db, state } from "../tg-session";
(async () => {
  const obl = await db.journalObligation.deleteMany({ where: { source: "zz3-probe" } });
  console.log("удалено обязательств ZZ3:", obl.count);
  const be = await db.bonusEntry.deleteMany({ where: { obligation: { source: "zz3-probe" } } }).catch(()=>({count:0}));
  console.log("bonusEntry:", be.count);
  const t = await db.journalTemplate.deleteMany({ where: { code: "zz3_bonus_probe" } });
  console.log("удалён шаблон ZZ3:", t.count);
  const flag = await db.journalTemplate.findUnique({ where: { code: "glass_items_list" }, select: { allowNoEvents: true } });
  console.log("allowNoEvents glass_items_list (должно быть true):", flag?.allowNoEvents);
  const org = await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { disabledJournalCodes: true } });
  console.log("выключенные журналы (должно быть []):", JSON.stringify(org?.disabledJournalCodes));
  const sh = await db.workShift.findMany({ where: { userId: state.users.cookA.id } });
  console.log("смен у повара (должно быть 0):", sh.length);
  const act = await db.journalTaskClaim.findMany({ where: { organizationId: "e2e-org-a", status: "active" }, select: { id: true, scopeLabel: true, dateKey: true, user: { select: { name: true } } } });
  console.log("активные задачи на стенде:", JSON.stringify(act.map(a=>({кто:a.user.name,что:a.scopeLabel,день:a.dateKey}))));
  await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,800));process.exit(1);});

import { db, state } from "../tg-session";
(async () => {
  const cook = state.users.cookA.id, cleaner = state.users.cleanerA.id, cookB = state.users.cookB.id;
  const tpl = await db.journalTemplate.upsert({
    where: { code: "zz3_bonus_probe" },
    update: { bonusAmountKopecks: 25000 },
    create: { code: "zz3_bonus_probe", name: "ZZ3 премиальная проверка", description: "ZZ3 тест премии", fields: [], bonusAmountKopecks: 25000, isActive: false, sortOrder: 999 },
  });
  const day = new Date("2026-09-20T00:00:00.000Z");
  const mk = async (userId: string, orgId: string, dedupe: string, target: string, tplId: string) =>
    db.journalObligation.upsert({
      where: { userId_dedupeKey: { userId, dedupeKey: dedupe } },
      update: { status: "pending", openedAt: null, targetPath: target },
      create: { organizationId: orgId, userId, templateId: tplId, journalCode: tplId === tpl.id ? "zz3_bonus_probe" : "hygiene", kind: "daily-journal", dateKey: day, status: "pending", targetPath: target, source: "zz3-probe", dedupeKey: dedupe },
    });
  const hyg = await db.journalTemplate.findUnique({ where: { code: "hygiene" } });
  const o1 = await mk(cook, "e2e-org-a", "zz3-plain", "/journals/hygiene", hyg!.id);
  const o2 = await mk(cook, "e2e-org-a", "zz3-bonus", "/mini/bonus/self", tpl.id);
  const o3 = await mk(cleaner, "e2e-org-a", "zz3-foreign-same-org", "/journals/hygiene", hyg!.id);
  const o4 = await mk(cookB, "e2e-org-b", "zz3-foreign-org", "/journals/hygiene", hyg!.id);
  console.log(JSON.stringify({ tpl: tpl.id, plain: o1.id, bonus: o2.id, foreignUser: o3.id, foreignOrg: o4.id }, null, 1));
  await db.$disconnect();
})().catch(e => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });

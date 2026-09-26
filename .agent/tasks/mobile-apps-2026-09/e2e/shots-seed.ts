// Демо-организация «Кафе «Демо»» для скриншотов магазинов — ТОЛЬКО e2e-база
// localhost:5432/wesetup_e2e. Повторяет POST /api/root/seed-demo-org
// (restaurant, пресет, 14 дней истории), затем тариф paid до 2027-12-31 и
// известные пароли владельцу, шеф-повару и повару. Идемпотентно: если
// организация с таким именем уже есть — только тариф и пароли.
// SHOTS_SEED_NOW=2026-09-27T13:30:00+03:00 — «сейчас» для сидера (записи за
// сегодня пишутся только до этого часа; ночью иначе день пустой).
// Запуск из d:/wt/mobile-apps:
//   DATABASE_URL=<e2e> DATABASE_URL_DIRECT=<e2e> npx tsx .agent/tasks/mobile-apps-2026-09/e2e/shots-seed.ts
const E2E = "postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable";
if (process.env.DATABASE_URL !== E2E) throw new Error("DATABASE_URL must be the e2e db");

const fakeNow = process.env.SHOTS_SEED_NOW;
if (fakeNow) {
  const shift = new Date(fakeNow).getTime() - Date.now();
  const RealDate = Date;
  class ShiftedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + shift);
      else super(...(args as [number]));
    }
    static now() {
      return RealDate.now() + shift;
    }
  }
  (globalThis as unknown as { Date: DateConstructor }).Date = ShiftedDate as unknown as DateConstructor;
}

export const ORG_NAME = "Кафе «Демо»";
export const PASSWORD = "DemoShots2026!";
export const OWNER_EMAIL = "owner@cafe-demo.local";
export const CHEF_EMAIL = "chef@cafe-demo.local";
export const COOK_EMAIL = "cook@cafe-demo.local";

async function main() {
  const bcrypt = (await import("bcryptjs")).default;
  const { db } = await import("@/lib/db");
  const { computeAutoJournalCodes, computeDisabledJournalCodes, getOnboardingPreset } = await import(
    "@/lib/onboarding-presets"
  );
  const { sphereToPreset } = await import("@/lib/org-profile");
  const { attachAccountForNewOrganization } = await import("@/lib/create-organization");
  const { seedDemoOrganizationData } = await import("@/lib/demo-organization");

  const orgType = "restaurant";
  const preset = getOnboardingPreset(sphereToPreset(orgType));
  let org = await db.organization.findFirst({ where: { name: ORG_NAME }, select: { id: true } });
  let seed: unknown = "reused";
  if (!org) {
    org = await db.organization.create({
      data: {
        name: ORG_NAME,
        type: orgType,
        subscriptionPlan: "free",
        disabledJournalCodes: computeDisabledJournalCodes(preset),
        autoJournalCodes: computeAutoJournalCodes(preset),
      },
      select: { id: true },
    });
    const owner = await db.user.create({
      data: {
        email: OWNER_EMAIL,
        name: "Орлов Сергей Викторович",
        role: "manager",
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        organizationId: org.id,
        isActive: true,
      },
      select: { id: true, name: true },
    });
    await attachAccountForNewOrganization(db, { ownerUserId: owner.id, organizationId: org.id, subscriptionPlan: "free" });
    seed = await seedDemoOrganizationData({
      organizationId: org.id,
      sphere: orgType,
      createdById: owner.id,
      extraEmployees: [{ id: owner.id, name: owner.name }],
      daysOfHistory: 14,
    });
    const positions = await db.jobPosition.findMany({
      where: { organizationId: org.id, name: { in: ["Управляющий", "Директор производства"] } },
      select: { id: true, name: true },
    });
    const pos = positions.find((p) => p.name === "Управляющий") ?? positions[0] ?? null;
    if (pos) await db.user.update({ where: { id: owner.id }, data: { jobPositionId: pos.id } });
  }

  const end = new Date("2027-12-31T20:59:59Z");
  const o = await db.organization.update({
    where: { id: org.id },
    data: { subscriptionPlan: "paid", subscriptionEnd: end },
    select: { accountId: true },
  });
  if (o.accountId) await db.account.update({ where: { id: o.accountId }, data: { subscriptionPlan: "paid", subscriptionEnd: end } });

  const hash = await bcrypt.hash(PASSWORD, 10);
  const users = await db.user.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, role: true, positionTitle: true, email: true } });
  const owner = users.find((u) => u.email === OWNER_EMAIL)!;
  const chef = users.find((u) => u.positionTitle === "Шеф-повар") ?? users.find((u) => u.role === "head_chef")!;
  const cook = users.find((u) => u.positionTitle === "Повар горячего цеха") ?? users.find((u) => u.role === "cook")!;
  await db.user.update({ where: { id: owner.id }, data: { passwordHash: hash, email: OWNER_EMAIL } });
  await db.user.update({ where: { id: chef.id }, data: { passwordHash: hash, email: CHEF_EMAIL } });
  await db.user.update({ where: { id: cook.id }, data: { passwordHash: hash, email: COOK_EMAIL } });
  console.log(
    JSON.stringify({ organizationId: org.id, seed, password: PASSWORD, owner: [OWNER_EMAIL, owner.name], chef: [CHEF_EMAIL, chef.name], cook: [COOK_EMAIL, cook.name] }, null, 2)
  );
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

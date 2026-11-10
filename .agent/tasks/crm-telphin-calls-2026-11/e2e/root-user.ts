import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
async function main() {
  const org = await db.organization.upsert({ where: { id: "e2e-platform" }, create: { id: "e2e-platform", name: "WeSetup (e2e)", type: "restaurant" }, update: {} });
  await db.user.upsert({
    where: { email: "root-e2e@wesetup.local" },
    create: { email: "root-e2e@wesetup.local", name: "Root e2e", passwordHash: await bcrypt.hash("E2e-telphin-1", 10), isRoot: true, role: "owner", organizationId: org.id },
    update: { passwordHash: await bcrypt.hash("E2e-telphin-1", 10), isRoot: true },
  });
  const c = await db.crmContact.findFirst({ where: { phoneKey: "9939173279" }, select: { id: true } });
  console.log("contact", c?.id);
  await db.$disconnect();
}
main();

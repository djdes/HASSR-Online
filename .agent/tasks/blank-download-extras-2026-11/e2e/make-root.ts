// Локальный ROOT для e2e (только тестовая база в контейнере).
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
async function main() {
  const passwordHash = await bcrypt.hash("e2e-root-pass", 10);
  await db.user.upsert({
    where: { email: "e2e-root@example.test" },
    update: { passwordHash, isRoot: true },
    create: { email: "e2e-root@example.test", name: "E2E Root", passwordHash, role: "owner", isRoot: true, organizationId: process.env.PLATFORM_ORG_ID || "platform" },
  });
  console.log("root ok");
  process.exit(0);
}
void main();

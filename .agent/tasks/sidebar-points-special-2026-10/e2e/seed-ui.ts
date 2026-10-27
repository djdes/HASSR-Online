/** Данные для UI-смоука задачи 2 на e2e-базе (НЕ прод). */
import { writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { LEGAL_VERSION } from "@/lib/legal-consent";

if (!/localhost:5432\/wesetup_e2e/.test(process.env.DATABASE_URL ?? "")) throw new Error("Only the e2e database is allowed");

async function main() {
  const stamp = Date.now().toString(36);
  const org = await db.organization.create({
    data: { name: `Замены ${stamp}`, type: "restaurant", perLocationJournals: true, timezone: "Europe/Moscow" },
  });
  const [a, b, c] = await Promise.all(
    ["Точка А", "Точка Б", "Точка В"].map((name, index) =>
      db.building.create({ data: { organizationId: org.id, name, address: `ул. Тестовая, ${index + 1}`, sortOrder: index } }),
    ),
  );
  const [mgmt, cook] = await Promise.all([
    db.jobPosition.create({ data: { organizationId: org.id, categoryKey: "management", name: "Управляющий" } }),
    db.jobPosition.create({ data: { organizationId: org.id, categoryKey: "staff", name: "Повар" } }),
  ]);
  const passwordHash = await bcrypt.hash("Passw0rd!", 10);
  const mk = (key: string, name: string, buildingIds: string[], role = "cook") =>
    db.user.create({
      data: {
        organizationId: org.id,
        name,
        email: `ui-${stamp}-${key}@e2e.local`,
        passwordHash,
        role,
        buildingIds,
        legalVersion: LEGAL_VERSION,
        showWhatsNew: false,
        positionTitle: role === "manager" ? "Управляющий" : "Повар",
        jobPositionId: role === "manager" ? mgmt.id : cook.id,
      },
    });
  const manager = await mk("manager", "Мария Управляющая", [], "manager");
  const anna = await mk("anna", "Анна Петрова", [a.id]);
  const boris = await mk("boris", "Борис Иванов", [a.id, b.id]);
  const galina = await mk("galina", "Галина Смирнова", [c.id]);
  const vera = await mk("vera", "Вера Везде", []);
  const out = {
    orgId: org.id,
    email: manager.email,
    password: "Passw0rd!",
    points: { a: a.id, b: b.id, c: c.id },
    users: { manager: manager.id, anna: anna.id, boris: boris.id, galina: galina.id, vera: vera.id },
  };
  writeFileSync(".agent/tasks/sidebar-points-special-2026-10/e2e/seed-ui.json", JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out));
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});

// Заведующая, закреплённая за «Точкой А», в тестовой организации (только e2e-база).
import bcrypt from "bcryptjs";
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "@/lib/db";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  const seed = JSON.parse(readFileSync(".agent/tasks/qr-point-roster-uv-2026-10/raw/seed.json", "utf8"));
  const pointA = await db.building.findFirst({ where: { organizationId: seed.orgId, name: "Точка А" }, select: { id: true } });
  if (!pointA) throw new Error("no point A");
  const email = `head-${seed.orgId}@verify.local`;
  await db.user.upsert({
    where: { email },
    update: { buildingIds: [pointA.id], role: "head_chef", isActive: true },
    create: { organizationId: seed.orgId, name: "Заведующая точки А", email, passwordHash: await bcrypt.hash("Verify-2026!", 10), role: "head_chef", isActive: true, buildingIds: [pointA.id] } as never,
  });
  // Руководителю — без запомненной точки: стартует со всей организации.
  await db.user.updateMany({ where: { email: `manager-${seed.orgId}@verify.local` }, data: { lastActiveBuildingId: null } });
  const out = { orgId: seed.orgId, manager: `manager-${seed.orgId}@verify.local`, head: email, pointA: pointA.id };
  writeFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", JSON.stringify(out));
  console.log(JSON.stringify(out));
}
main().finally(() => db.$disconnect());

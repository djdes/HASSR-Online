/**
 * e2e-БД (НЕ прод): две точки, у каждой свой холодильник, УФ-лампа и повар;
 * заведующая точки А; выполненные задачи поваров обеих точек.
 *
 * DATABASE_URL=…/wesetup_e2e node --import tsx .agent/tasks/point-today-pool-2026-10-31/raw/fixture.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

import { db } from "@/lib/db";

const DIR = ".agent/tasks/point-today-pool-2026-10-31/raw";
const MARK = "ПРОВЕРКА 31.10";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
  const orgId: string = seed.orgId;
  await db.organization.update({ where: { id: orgId }, data: { perLocationJournals: true } });
  const buildings = await db.building.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  const a = buildings.find((b) => b.name === "Точка А");
  const b = buildings.find((b) => b.name === "Точка Б");
  if (!a || !b) throw new Error(`нет точек А/Б: ${buildings.map((x) => x.name).join(", ")}`);
  const manager = await db.user.findFirstOrThrow({ where: { email: seed.manager }, select: { passwordHash: true } });

  // Прошлый прогон — убрать.
  await db.journalTaskClaim.deleteMany({ where: { organizationId: orgId, scopeLabel: { startsWith: MARK } } });
  await db.equipment.deleteMany({ where: { area: { organizationId: orgId }, name: { startsWith: MARK } } });
  await db.room.deleteMany({ where: { building: { organizationId: orgId }, name: { startsWith: MARK } } });
  await db.user.deleteMany({ where: { organizationId: orgId, email: { startsWith: "check-3110-" } } });

  const areaFor = async (buildingId: string, name: string) =>
    (await db.area.findFirst({ where: { organizationId: orgId, buildingId }, select: { id: true } })) ??
    (await db.area.create({ data: { organizationId: orgId, buildingId, name }, select: { id: true } }));
  const areaA = await areaFor(a.id, "Цех точки А");
  const areaB = await areaFor(b.id, "Цех точки Б");
  const mkEquipment = (areaId: string, name: string, type: string) =>
    db.equipment.create({ data: { areaId, name, type, ...(type === "refrigerator" ? { tempMin: 2, tempMax: 6 } : {}) }, select: { id: true, name: true } });
  const fridgeA = await mkEquipment(areaA.id, `${MARK} ШХ точки А`, "refrigerator");
  const fridgeB = await mkEquipment(areaB.id, `${MARK} ШХ точки Б`, "refrigerator");
  const lampA = await mkEquipment(areaA.id, `${MARK} УФ-лампа точки А`, "uv_lamp");
  const lampB = await mkEquipment(areaB.id, `${MARK} УФ-лампа точки Б`, "uv_lamp");
  const roomA = await db.room.create({ data: { buildingId: a.id, name: `${MARK} Склад точки А` }, select: { id: true, name: true } });
  const roomB = await db.room.create({ data: { buildingId: b.id, name: `${MARK} Склад точки Б` }, select: { id: true, name: true } });

  const mkUser = (key: string, name: string, role: string, buildingIds: string[]) =>
    db.user.create({
      data: { organizationId: orgId, email: `check-3110-${key}@verify.local`, name, role, passwordHash: manager.passwordHash, buildingIds },
      select: { id: true, email: true, name: true },
    });
  const cookA = await mkUser("cook-a", `${MARK} Повар Анна (точка А)`, "cook", [a.id]);
  const cookB = await mkUser("cook-b", `${MARK} Повар Борис (точка Б)`, "cook", [b.id]);
  const headA = await mkUser("head-a", `${MARK} Заведующая Ирина (точка А)`, "head_chef", [a.id]);
  // Поварам — доступ к журналам задач; руководство на всю сеть — режим «Вся организация».
  for (const cook of [cookA, cookB]) {
    await db.userJournalAccess.createMany({
      data: ["cold_equipment_control", "uv_lamp_runtime", "climate_control"].map((templateCode) => ({ userId: cook.id, templateCode })),
    });
  }
  await db.user.update({ where: { email: seed.manager }, data: { lastActiveBuildingId: null } });

  // Выполненные задачи обоих поваров — ждут проверки.
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const [user, fridge] of [[cookA, fridgeA], [cookB, fridgeB]] as const) {
    await db.journalTaskClaim.create({
      data: {
        organizationId: orgId,
        journalCode: "cold_equipment_control",
        scopeKey: `fridge:${fridge.id}:morning:${today.toISOString().slice(0, 10)}`,
        scopeLabel: `${MARK} ${fridge.name} — Утро`,
        dateKey: today,
        userId: user.id,
        status: "completed",
        completedAt: now,
        verificationStatus: "pending",
      },
    });
  }

  const out = {
    orgId,
    pointA: a.id,
    pointB: b.id,
    password: "Verify-2026!",
    owner: seed.manager,
    cookA: cookA.email,
    cookB: cookB.email,
    headA: headA.email,
    names: {
      fridgeA: fridgeA.name, fridgeB: fridgeB.name, lampA: lampA.name, lampB: lampB.name,
      roomA: roomA.name, roomB: roomB.name, cookA: cookA.name, cookB: cookB.name,
    },
  };
  writeFileSync(`${DIR}/fixture.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().finally(() => db.$disconnect());

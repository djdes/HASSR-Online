/**
 * Отдельная копия e2e-базы (НЕ прод): wesetup_ptinteg. Офис + две точки,
 * по холодильнику на точку, руководитель точки А (manager, только точка А).
 *
 * DATABASE_URL=…/wesetup_ptinteg node --import tsx .agent/tasks/point-deep-audit-2026-11-01/raw/fixture.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

import { db } from "@/lib/db";

const DIR = ".agent/tasks/point-deep-audit-2026-11-01/raw";
const MARK = "ПРОВЕРКА 01.11";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_ptinteg")) throw new Error("ptinteg only");
  const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
  const orgId: string = seed.orgId;
  await db.organization.update({ where: { id: orgId }, data: { perLocationJournals: true } });
  const buildings = await db.building.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, kind: true } });
  const a = buildings.find((b) => b.name === "Точка А")!;
  const b = buildings.find((b) => b.name === "Точка Б")!;
  const office =
    buildings.find((x) => x.kind === "office") ??
    (await db.building.create({ data: { organizationId: orgId, name: "Офис", kind: "office", sortOrder: -1 }, select: { id: true, name: true, kind: true } }));

  await db.equipment.deleteMany({ where: { area: { organizationId: orgId }, name: { startsWith: MARK } } });
  const areaFor = async (buildingId: string) =>
    (await db.area.findFirst({ where: { organizationId: orgId, buildingId }, select: { id: true } }))!;
  const fridgeA = await db.equipment.create({ data: { areaId: (await areaFor(a.id)).id, name: `${MARK} ШХ точки А`, type: "refrigerator", tempMin: 2, tempMax: 6 }, select: { id: true } });
  const fridgeB = await db.equipment.create({ data: { areaId: (await areaFor(b.id)).id, name: `${MARK} ШХ точки Б`, type: "refrigerator", tempMin: 2, tempMax: 6 }, select: { id: true } });

  const hygiene = await db.journalTemplate.findUniqueOrThrow({ where: { code: "hygiene" }, select: { id: true, fillMode: true, defaultAssigneeId: true, bonusAmountKopecks: true } });
  const docA = await db.journalDocument.findFirstOrThrow({ where: { organizationId: orgId, templateId: hygiene.id, status: "active", buildingId: a.id }, select: { id: true } });
  const docB = await db.journalDocument.findFirstOrThrow({ where: { organizationId: orgId, templateId: hygiene.id, status: "active", buildingId: b.id }, select: { id: true } });
  await db.organizationJournalSetting.deleteMany({ where: { organizationId: orgId } });

  const cookB = await db.user.findUniqueOrThrow({ where: { email: "check-3110-cook-b@verify.local" }, select: { id: true } });
  const fixture = {
    orgId,
    password: "Verify-2026!",
    office: office.id,
    pointA: a.id,
    pointB: b.id,
    owner: seed.manager,
    cookA: "check-3110-cook-a@verify.local",
    cookB: "check-3110-cook-b@verify.local",
    cookBId: cookB.id,
    pointManagerA: "check-0111-head-a@verify.local",
    fridgeA: fridgeA.id,
    fridgeB: fridgeB.id,
    hygieneDocA: docA.id,
    hygieneDocB: docB.id,
    hygieneTemplateBefore: hygiene,
  };
  writeFileSync(`${DIR}/fixture.json`, JSON.stringify(fixture, null, 2));
  console.log(JSON.stringify(fixture, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

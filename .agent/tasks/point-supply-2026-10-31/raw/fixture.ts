/**
 * e2e-БД (НЕ прод): накладные трёх видов (точка по КПП, без точки, точка Б),
 * этикетки и потери точек, руководитель точки А и руководство на всю сеть.
 *
 * DATABASE_URL=…/wesetup_e2e node --import tsx .agent/tasks/point-supply-2026-10-31/raw/fixture.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

import { db } from "@/lib/db";
import { saveSupplyDocument } from "@/lib/supply/documents.server";
import { parseUpd } from "@/lib/supply/upd";
import { toCp1251, UPD_501 } from "@/lib/supply/upd-fixtures";

const DIR = ".agent/tasks/point-supply-2026-10-31/raw";
const MARK = "ПРОВЕРКА 01.11";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
  const orgId: string = seed.orgId;
  await db.organization.update({ where: { id: orgId }, data: { perLocationJournals: true } });
  const buildings = await db.building.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  const a = buildings.find((b) => b.name === "Точка А");
  const b = buildings.find((b) => b.name === "Точка Б");
  if (!a || !b) throw new Error(`нет точек А/Б: ${buildings.map((x) => x.name).join(", ")}`);
  // КПП грузополучателя из образца УПД — у точки А, у остальных другой.
  await db.building.updateMany({ where: { organizationId: orgId, id: { not: a.id } }, data: { kpp: "500199001" } });
  await db.building.update({ where: { id: a.id }, data: { kpp: "500102001" } });
  const manager = await db.user.findFirstOrThrow({ where: { email: seed.manager }, select: { passwordHash: true } });
  await db.user.update({ where: { email: seed.manager }, data: { lastActiveBuildingId: null } });

  // Прошлый прогон — убрать.
  await db.supplyDocument.deleteMany({ where: { organizationId: orgId } });
  await db.lossRecord.deleteMany({ where: { organizationId: orgId, productName: { startsWith: MARK } } });
  await db.labelPrint.deleteMany({ where: { organizationId: orgId, item: { startsWith: MARK } } });
  await db.supplyConnection.deleteMany({ where: { organizationId: orgId, provider: "iiko" } });
  await db.user.deleteMany({ where: { organizationId: orgId, email: { startsWith: "check-0111-" } } });

  const headA = await db.user.create({
    data: { organizationId: orgId, email: "check-0111-head-a@verify.local", name: `${MARK} Руководитель точки А`, role: "manager", passwordHash: manager.passwordHash, buildingIds: [a.id] },
    select: { id: true, email: true },
  });

  // 1) УПД с грузополучателем точки А — точка по КПП.
  const byKpp = await saveSupplyDocument({ organizationId: orgId, source: "upload", externalId: "check-0111-kpp", parsed: parseUpd(toCp1251(UPD_501)) });
  const kppDoc = await db.supplyDocument.update({ where: { id: byKpp.id }, data: { sellerName: `${MARK} Поставщик по КПП` }, select: { id: true, buildingId: true } });
  // 2) Без точки и 3) точки Б.
  const base = {
    organizationId: orgId,
    source: "upload",
    kind: "upd",
    date: new Date("2026-10-31T00:00:00.000Z"),
    items: [{ line: 1, name: "Молоко 3,2%", unit: "л", quantity: 10, price: 80, amount: 800, code: null, expiryDate: null }],
  };
  const noPoint = await db.supplyDocument.create({ data: { ...base, externalId: "check-0111-none", number: "Н-1", sellerName: `${MARK} Поставщик без точки` }, select: { id: true } });
  const pointB = await db.supplyDocument.create({ data: { ...base, externalId: "check-0111-b", number: "Б-1", sellerName: `${MARK} Поставщик точки Б`, buildingId: b.id }, select: { id: true } });

  // Этикетки и потери: точка А, точка Б, без точки.
  const now = new Date();
  for (const [key, buildingId] of [["А", a.id], ["Б", b.id], ["общая", null]] as const) {
    await db.labelPrint.create({
      data: {
        organizationId: orgId,
        eventId: `check-0111-${key}`,
        printerAddress: "00:11:22:33:44:55",
        template: "product",
        templateTitle: "Продукт",
        copies: 1,
        item: `${MARK} Этикетка ${key}`,
        printedAt: now,
        buildingId,
      },
    });
    await db.lossRecord.create({
      data: { organizationId: orgId, category: "writeoff", productName: `${MARK} Потеря ${key}`, quantity: 1, unit: "kg", buildingId },
    });
  }
  // Подключение iiko для проверки сопоставления складов (ключи не нужны — PUT их не читает).
  await db.supplyConnection.create({
    data: {
      organizationId: orgId,
      provider: "iiko",
      credentialsEnc: "e2e-not-used",
      storePoints: { stores: [{ id: "st-kitchen", name: "Склад кухни", department: "Гимназия № 4" }], map: {} },
    },
  });

  const out = {
    orgId,
    pointA: a.id,
    pointB: b.id,
    password: "Verify-2026!",
    owner: seed.manager,
    headA: headA.email,
    kppDocId: kppDoc.id,
    kppDocPoint: kppDoc.buildingId,
    noPointDocId: noPoint.id,
    pointBDocId: pointB.id,
    mark: MARK,
  };
  writeFileSync(`${DIR}/fixture.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().finally(() => db.$disconnect());

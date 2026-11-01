/**
 * Данные точек А и Б для поиска утечек (локальная wesetup_iso, не прод).
 * Метки в названиях: «Альфа» — точка А, «Бета» — точка Б, «Чужой» — вторая
 * организация. Скрипт проверки ищет «Бета» в ответах людям точки А.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { db } from "@/lib/db";

const DIR = ".agent/tasks/point-isolation-audit-2026-11-01/raw";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_iso")) throw new Error("wesetup_iso only");
  const fx = JSON.parse(readFileSync(`${DIR}/fixture.json`, "utf8"));
  const orgId: string = fx.orgId;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const points = [
    { key: "A", id: fx.pointA as string, tag: "Альфа", cook: fx.users.cookA.id as string, area: fx.areaA as string, fridge: fx.fridgeA as string },
    { key: "B", id: fx.pointB as string, tag: "Бета", cook: fx.users.cookB.id as string, area: fx.areaB as string, fridge: fx.fridgeB as string },
  ];
  const hygiene = await db.journalTemplate.findUniqueOrThrow({ where: { code: "hygiene" }, select: { id: true } });
  const out: Record<string, Record<string, string>> = {};
  for (const point of points) {
    const ids: Record<string, string> = {};
    ids.capa = (await db.capaTicket.create({ data: { organizationId: orgId, title: `CAPA ${point.tag}`, buildingId: point.id } })).id;
    ids.batch = (await db.batch.create({ data: { organizationId: orgId, code: `BATCH-${point.key}`, productName: `Партия ${point.tag}`, quantity: 1, buildingId: point.id } as never })).id;
    ids.loss = (await db.lossRecord.create({ data: { organizationId: orgId, category: "spoilage", productName: `Списание ${point.tag}`, quantity: 1, buildingId: point.id, areaId: point.area } as never })).id;
    ids.supply = (await db.supplyDocument.create({ data: { organizationId: orgId, source: "file", externalId: `sup-${point.key}`, number: `НАКЛ-${point.tag}`, date: today, sellerName: `Поставщик ${point.tag}`, items: [], buildingId: point.id } as never })).id;
    ids.label = (await db.labelPrint.create({ data: { organizationId: orgId, eventId: `evt-${point.key}`, printerAddress: "127.0.0.1", template: "t", templateTitle: `Этикетка ${point.tag}`, copies: 1, item: `Продукт ${point.tag}`, printedAt: now, buildingId: point.id } as never })).id;
    ids.printAgent = (await db.printAgent.create({ data: { organizationId: orgId, name: `Принтер ${point.tag}`, tokenHash: createHash("sha256").update(`agent-${point.key}-${orgId}`).digest("hex"), buildingId: point.id } as never })).id;
    ids.printJob = (await db.printJob.create({ data: { organizationId: orgId, docTitle: `Печать ${point.tag}`, buildingId: point.id } as never })).id;
    ids.inspector = (await db.inspectorToken.create({ data: { organizationId: orgId, tokenHash: createHash("sha256").update(`insp-${point.key}-${orgId}`).digest("hex"), label: `Проверяющий ${point.tag}`, periodFrom: new Date(now.getTime() - 30 * 864e5), periodTo: now, expiresAt: new Date(now.getTime() + 30 * 864e5), buildingId: point.id } as never })).id;
    ids.competency = (await db.staffCompetency.create({ data: { organizationId: orgId, userId: point.cook, skill: `Навык ${point.tag}` } as never })).id;
    ids.shift = (await db.workShift.create({ data: { organizationId: orgId, userId: point.cook, date: today } as never })).id;
    ids.notification = (await db.notification.create({ data: { organizationId: orgId, userId: point.cook, kind: "test", dedupeKey: `iso-${point.key}`, title: `Уведомление ${point.tag}` } as never })).id;
    ids.obligation = (await db.journalObligation.create({ data: { organizationId: orgId, userId: point.cook, templateId: hygiene.id, journalCode: "hygiene", dateKey: today, targetPath: `/journals/hygiene/documents/${fx.docs.hygiene[point.key]}`, dedupeKey: `iso-obl-${point.key}`, buildingId: point.id } as never })).id;
    out[point.key] = ids;
  }
  fx.data = out;
  fx.inspectorRaw = { A: `insp-A-${orgId}`, B: `insp-B-${orgId}` };
  fx.agentRaw = { A: `agent-A-${orgId}`, B: `agent-B-${orgId}` };
  writeFileSync(`${DIR}/fixture.json`, JSON.stringify(fx, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

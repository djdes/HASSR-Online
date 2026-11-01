/**
 * Дополнение фикстуры для воспроизведения находок (локальная wesetup_iso, не прод):
 *  - руководитель на всю компанию, закреплённый за офисом и точкой А;
 *  - токен внешнего API организации, вебхук с секретом;
 *  - шаблон чек-листа и назначения на точку Б и повара Б;
 *  - посещение проверяющего по ссылке точки Б;
 *  - выполненная задача повара Б, ждущая проверки.
 */
import bcrypt from "bcryptjs";
import { readFileSync, writeFileSync } from "node:fs";

import { db } from "@/lib/db";
import { SANPIN_CHECKLIST } from "@/lib/checklist-templates/sanpin";

const DIR = ".agent/tasks/point-isolation-audit-2026-11-01/raw";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_iso")) throw new Error("wesetup_iso only");
  const fx = JSON.parse(readFileSync(`${DIR}/fixture.json`, "utf8"));
  const orgId: string = fx.orgId;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const officeA = await db.user.create({
    data: {
      organizationId: orgId,
      email: "iso-office-a@verify.local",
      name: "Директор Офис-Альфа",
      role: "manager",
      buildingIds: [fx.office, fx.pointA],
      jobPositionId: fx.positions.manager,
      passwordHash: await bcrypt.hash(fx.password, 10),
      isActive: true,
    } as never,
    select: { id: true, email: true },
  });
  await db.organization.update({ where: { id: orgId }, data: { externalApiToken: `iso-ext-${orgId}` } });
  const webhook = await db.webhook.create({
    data: { organizationId: orgId, url: "https://example.invalid/hook", secret: "iso-webhook-secret-Бета", events: ["journal.entry"] },
    select: { id: true },
  });

  const template = await db.checklistTemplate.create({
    data: { organizationId: orgId, title: "Чек-лист ИСО", definition: SANPIN_CHECKLIST.definition as never },
    select: { id: true },
  });
  const owner = fx.users.owner;
  const assignment = (targetKind: string, targetId: string) =>
    db.checklistAssignment.create({
      data: {
        organizationId: orgId,
        templateId: template.id,
        targetKind,
        targetId,
        frequency: "daily",
        dueTime: "18:00",
        createdById: owner.id,
        createdByName: "Владелец ИСО",
      } as never,
      select: { id: true },
    });
  const assignB = await assignment("building", fx.pointB);
  const assignCookB = await assignment("user", fx.users.cookB.id);
  const assignA = await assignment("building", fx.pointA);

  const visitB = await db.inspectionVisit.create({
    data: {
      organizationId: orgId,
      source: "qr",
      inspectorName: "Инспектор Бета",
      authority: "Роспотребнадзор",
      kind: "planned",
      tokenId: fx.data.B.inspector,
    } as never,
    select: { id: true },
  });

  const claimB = await db.journalTaskClaim.create({
    data: {
      organizationId: orgId,
      journalCode: "hygiene",
      scopeKey: `hygiene:${fx.docs.hygiene.B}:${fx.users.cookB.id}`,
      scopeLabel: "Гигиена Бета задача",
      dateKey: today,
      userId: fx.users.cookB.id,
      status: "completed",
      completedAt: now,
      verificationStatus: "pending",
    } as never,
    select: { id: true },
  });

  fx.more = {
    officeA,
    externalToken: `iso-ext-${orgId}`,
    webhook: webhook.id,
    checklistTemplate: template.id,
    assignB: assignB.id,
    assignCookB: assignCookB.id,
    assignA: assignA.id,
    visitB: visitB.id,
    claimB: claimB.id,
  };
  writeFileSync(`${DIR}/fixture.json`, JSON.stringify(fx, null, 2));
  console.log(JSON.stringify(fx.more, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

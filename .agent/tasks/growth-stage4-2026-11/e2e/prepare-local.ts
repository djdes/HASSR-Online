/**
 * Локальный стенд (только локальная база) для проверки отзывов, AC3:
 *  - заведение-кандидат «Кафе «Проверка отзывов»»: в WeSetup 60 дней,
 *    40 записей журнала за последние 30 дней, оценка 5 в опросе, руководитель
 *    с почтой — должно попасть в «Кого попросить об отзыве»;
 *  - у управляющего демо-кухни (stage3-e2e-manager) — старые отзывы и
 *    отметки «просили» стенда убираются, чтобы прогон начинался с чистого листа.
 * Запуск: npx tsx --env-file=.env .agent/tasks/growth-stage4-2026-11/e2e/prepare-local.ts
 */
import { db } from "@/lib/db";
import { platformOrgId } from "@/lib/partners/partner-hint";
import { REVIEW_REQUEST_ACTION } from "@/lib/review-requests";

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Только для локальной базы: DATABASE_URL должен указывать на 127.0.0.1 или localhost");
}

const DAY_MS = 86_400_000;
const CANDIDATE_NAME = "Кафе «Проверка отзывов»";
const CANDIDATE_EMAIL = "stage4-candidate@example.test";
const MANAGER_EMAIL = "stage3-e2e-manager@example.test";

async function main() {
  const now = new Date();
  const template = await db.journalTemplate.findFirstOrThrow({ where: { code: "fryer_oil" }, select: { id: true } });

  // Кандидат: заново каждый прогон.
  const old = await db.organization.findMany({ where: { name: CANDIDATE_NAME }, select: { id: true } });
  for (const org of old) {
    await db.auditLog.deleteMany({ where: { organizationId: platformOrgId(), action: REVIEW_REQUEST_ACTION, entityId: org.id } });
    await db.organization.delete({ where: { id: org.id } });
  }
  await db.user.deleteMany({ where: { email: CANDIDATE_EMAIL } });
  const org = await db.organization.create({
    data: { name: CANDIDATE_NAME, type: "cafe", createdAt: new Date(now.getTime() - 60 * DAY_MS) },
  });
  const manager = await db.user.create({
    data: { email: CANDIDATE_EMAIL, name: "Ирина Кандидатова", role: "manager", organizationId: org.id, passwordHash: "e2e-not-a-real-hash" },
  });
  await db.journalEntry.createMany({
    data: Array.from({ length: 40 }, (_, index) => ({
      templateId: template.id,
      organizationId: org.id,
      filledById: manager.id,
      data: { note: `запись ${index + 1}` },
      createdAt: new Date(now.getTime() - (index % 28) * DAY_MS - 3600_000),
    })),
  });
  await db.npsResponse.create({ data: { organizationId: org.id, userId: manager.id, score: 5, scale: 5 } });

  // Демо-кухня: отзывы стенда — заново.
  const demoManager = await db.user.findUnique({ where: { email: MANAGER_EMAIL }, select: { id: true, organizationId: true } });
  if (demoManager) await db.customerReview.deleteMany({ where: { organizationId: demoManager.organizationId } });

  console.log(JSON.stringify({ candidate: { id: org.id, name: CANDIDATE_NAME, managerEmail: CANDIDATE_EMAIL, records30: 40 }, demoOrganizationId: demoManager?.organizationId ?? null }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

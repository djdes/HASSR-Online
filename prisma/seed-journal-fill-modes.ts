/**
 * One-shot idempotent seed: проставить дефолтный `fillMode` всем
 * существующим `JournalTemplate`-ам и почистить стейл-obligations,
 * которые остались от старого «всем-подряд» поведения.
 *
 * Дефолты (Q3 = A в docs/journal-distribution-plan.md):
 *   per-employee — журналы где каждый сотрудник заполняет за себя:
 *                  hygiene, health_check, ppe_issuance
 *   single       — все остальные шаблоны (один исполнитель за смену)
 *   sensor       — только если в JournalTemplate уже выставлено вручную
 *                  (пока никаких автоматических сенсоров нет)
 *
 * Идемпотентно: запускается на каждом deploy, проставляет fillMode
 * только если он совпадает с default-значением колонки ("per-employee")
 * и нет явной настройки. Так менеджеры, которые уже поправили fillMode
 * в /settings/journals, не получают «откат» к нашим дефолтам.
 *
 * Cleanup stale obligations:
 * Если шаблон стал `single` или `sensor`, но в БД остались obligations
 * от прежнего per-employee режима — они зависают у сотрудников как
 * «ложные» задачи. Удаляем все obligations за сегодня и будущее
 * (прошлые не трогаем — это исторические данные) для не-per-employee
 * шаблонов, оставляя ровно одно (или ноль) obligation на день.
 *
 * Запускается автоматически из deploy workflow:
 *   npx tsx prisma/seed-journal-fill-modes.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PER_EMPLOYEE_CODES = new Set([
  "hygiene",
  "health_check",
  "ppe_issuance",
]);

async function main() {
  const templates = await prisma.journalTemplate.findMany({
    select: { id: true, code: true, fillMode: true },
  });

  let perEmployeeCount = 0;
  let singleCount = 0;
  let unchanged = 0;

  for (const template of templates) {
    const expected = PER_EMPLOYEE_CODES.has(template.code)
      ? "per-employee"
      : "single";

    // Не перезаписываем если менеджер вручную выставил sensor (его
    // в наших дефолтах нет, значит руками поставили), или если уже
    // совпадает.
    if (template.fillMode === expected) {
      unchanged++;
      continue;
    }
    if (template.fillMode === "sensor") {
      // Sensor оставляем — это явный выбор менеджера, не наш default.
      unchanged++;
      continue;
    }

    // Если default колонки `per-employee` и `expected` тоже
    // `per-employee` — записи уже совпадают, цикл прошёл выше.
    // Сюда попадаем когда нужно сменить с `per-employee` (default)
    // на `single` для не-per-employee-шаблонов.
    await prisma.journalTemplate.update({
      where: { id: template.id },
      data: { fillMode: expected },
    });
    if (expected === "per-employee") perEmployeeCount++;
    else singleCount++;
  }

  console.log(
    `[seed-fill-modes] per-employee=${perEmployeeCount}, single=${singleCount}, unchanged=${unchanged}`
  );

  // Cleanup: для не-per-employee шаблонов удаляем obligations за
  // сегодня и будущее, кроме тех что принадлежат текущему
  // defaultAssigneeId (чтобы не трогать корректное состояние после
  // настройки менеджером).
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);

  const nonPerEmployee = await prisma.journalTemplate.findMany({
    where: { fillMode: { not: "per-employee" } },
    select: { id: true, code: true, fillMode: true, defaultAssigneeId: true },
  });

  let cleanedCount = 0;
  for (const template of nonPerEmployee) {
    // Организации со своим распределением журнала (`OrganizationJournalSetting`,
    // 2026-11-01) не трогаем: режим шаблона для них не действует.
    const ownSettingOrgs = (
      await prisma.organizationJournalSetting.findMany({
        where: { templateId: template.id, fillMode: { not: null } },
        select: { organizationId: true },
      })
    ).map((row) => row.organizationId);
    const result = await prisma.journalObligation.deleteMany({
      where: {
        templateId: template.id,
        dateKey: { gte: todayUtc },
        ...(ownSettingOrgs.length > 0 ? { organizationId: { notIn: ownSettingOrgs } } : {}),
        // Если есть defaultAssigneeId — оставляем obligations этого
        // пользователя, удаляем чужие (но только для single, sensor
        // не должен иметь obligations вообще).
        ...(template.fillMode === "single" && template.defaultAssigneeId
          ? { userId: { not: template.defaultAssigneeId } }
          : {}),
      },
    });
    cleanedCount += result.count;
  }

  console.log(
    `[seed-fill-modes] cleanup: ${cleanedCount} stale obligations removed`
  );
}

main()
  .catch((err) => {
    console.error("[seed-fill-modes] fail:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

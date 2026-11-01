/**
 * Разовый перенос (2026-11-01): «Распределение» и «Бонус» журналов раньше
 * писались в общий `JournalTemplate` — правка одной организации действовала
 * на всех. Теперь это `OrganizationJournalSetting`. Скрипт находит в шаблонах
 * значения, отличные от платформенных дефолтов, и показывает, чьи они.
 *
 *   node --import tsx scripts/move-journal-template-settings-to-orgs.ts            # только отчёт
 *   node --import tsx scripts/move-journal-template-settings-to-orgs.ts --apply    # перенести исполнителя
 *   … --apply --reset-defaults   # ещё и вернуть шаблонам дефолтные режим и бонус,
 *                                # сохранив бонус организациям, где им уже пользовались
 *
 * Без `--apply` ничего не пишет. Запуск на проде — только с разрешения владельца.
 */
import { db } from "@/lib/db";

const PER_EMPLOYEE_CODES = new Set(["hygiene", "health_check", "ppe_issuance"]);
const apply = process.argv.includes("--apply");
const resetDefaults = process.argv.includes("--reset-defaults");

function defaultFillMode(code: string): string {
  return PER_EMPLOYEE_CODES.has(code) ? "per-employee" : "single";
}

async function main() {
  const templates = await db.journalTemplate.findMany({
    select: { id: true, code: true, fillMode: true, defaultAssigneeId: true, bonusAmountKopecks: true },
    orderBy: { code: "asc" },
  });
  const changed = templates.filter(
    (template) =>
      template.defaultAssigneeId !== null ||
      template.bonusAmountKopecks > 0 ||
      template.fillMode !== defaultFillMode(template.code),
  );
  console.log(`[move-settings] шаблонов: ${templates.length}, с не-дефолтными значениями: ${changed.length}`);

  for (const template of changed) {
    const assignee = template.defaultAssigneeId
      ? await db.user.findUnique({ where: { id: template.defaultAssigneeId }, select: { organizationId: true } })
      : null;
    const bonusOrgs = template.bonusAmountKopecks > 0
      ? (
          await db.bonusEntry.findMany({
            where: { templateId: template.id },
            distinct: ["organizationId"],
            select: { organizationId: true },
          })
        ).map((row) => row.organizationId)
      : [];
    console.log(
      JSON.stringify({
        code: template.code,
        fillMode: template.fillMode,
        defaultFillMode: defaultFillMode(template.code),
        assigneeOrg: assignee?.organizationId ?? null,
        bonusAmountKopecks: template.bonusAmountKopecks,
        bonusUsedByOrgs: bonusOrgs.length,
      }),
    );
    if (!apply) continue;

    // Исполнитель — человек одной организации: ей и отдаём вместе с режимом и бонусом шаблона.
    if (assignee) {
      await db.organizationJournalSetting.upsert({
        where: { organizationId_templateId: { organizationId: assignee.organizationId, templateId: template.id } },
        create: {
          organizationId: assignee.organizationId,
          templateId: template.id,
          fillMode: template.fillMode,
          defaultAssigneeId: template.defaultAssigneeId,
          bonusAmountKopecks: template.bonusAmountKopecks > 0 ? template.bonusAmountKopecks : null,
        },
        update: {},
      });
      await db.journalTemplate.update({ where: { id: template.id }, data: { defaultAssigneeId: null } });
    }
    if (resetDefaults) {
      // Бонус оставляем тем, у кого им уже пользовались; остальным — дефолт шаблона.
      for (const organizationId of bonusOrgs) {
        await db.organizationJournalSetting.upsert({
          where: { organizationId_templateId: { organizationId, templateId: template.id } },
          create: { organizationId, templateId: template.id, bonusAmountKopecks: template.bonusAmountKopecks },
          update: {},
        });
      }
      await db.journalTemplate.update({
        where: { id: template.id },
        data: {
          bonusAmountKopecks: 0,
          ...(template.fillMode === "sensor" ? {} : { fillMode: defaultFillMode(template.code) }),
        },
      });
    }
  }
  console.log(apply ? "[move-settings] применено" : "[move-settings] только отчёт (без --apply)");
}

main()
  .catch((error) => {
    console.error("[move-settings] ошибка:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

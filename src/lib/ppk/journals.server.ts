import { db } from "@/lib/db";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";

/**
 * Включённые в кабинете журналы для выбора в блоках ППК (например, журнал
 * записей ККТ): активные шаблоны минус выключенные в «Журналы → Настройка».
 */
export async function loadEnabledJournals(
  organizationId: string,
  /** ППК точки (2026-11-01) — журналы, включённые на этой точке. */
  buildingId: string | null = null,
): Promise<{ code: string; name: string }[]> {
  const [templates, disabled] = await Promise.all([
    db.journalTemplate.findMany({
      where: { isActive: true },
      select: { code: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    getDisabledJournalCodes(organizationId, buildingId),
  ]);
  return templates.filter((template) => !disabled.has(template.code));
}

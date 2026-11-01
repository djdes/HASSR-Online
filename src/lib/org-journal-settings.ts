import { db } from "@/lib/db";

/**
 * Настройки журнала у организации (2026-11-01): распределение (`fillMode`),
 * исполнитель по умолчанию и бонус за заполнение.
 *
 * Раньше «Распределение» и «Бонус» в /settings/journals писали прямо в
 * `JournalTemplate` — общий для всех организаций платформы: руководитель
 * одного клиента менял задачи и бонусы у всех. Теперь правка ложится в
 * `OrganizationJournalSetting`, а значение шаблона остаётся платформенным
 * дефолтом (null в настройке — взять дефолт).
 */
export type OrgJournalOverride = {
  fillMode: string | null;
  defaultAssigneeId: string | null;
  bonusAmountKopecks: number | null;
};

type TemplateSettings = {
  fillMode?: string | null;
  defaultAssigneeId?: string | null;
  bonusAmountKopecks?: number | null;
};

/**
 * Значения шаблона для организации: своё, если задано, иначе шаблона.
 * Исполнитель — всегда из настройки организации, если она есть: «без
 * исполнителя» — тоже выбор, а исполнитель в шаблоне — человек какой-то
 * одной организации. Поля, которых нет у переданного объекта, не добавляются.
 */
export function withOrgJournalOverride<T extends TemplateSettings>(
  template: T,
  override: OrgJournalOverride | null | undefined,
): T {
  if (!override) return template;
  const next = { ...template };
  if ("fillMode" in template && override.fillMode !== null) next.fillMode = override.fillMode;
  if ("defaultAssigneeId" in template) next.defaultAssigneeId = override.defaultAssigneeId;
  if ("bonusAmountKopecks" in template && override.bonusAmountKopecks !== null) {
    next.bonusAmountKopecks = override.bonusAmountKopecks;
  }
  return next;
}

/** Свои настройки журналов организации: templateId → настройка. */
export async function loadOrgJournalOverrides(
  organizationId: string,
  templateIds?: readonly string[],
): Promise<Map<string, OrgJournalOverride>> {
  const rows = await db.organizationJournalSetting.findMany({
    where: {
      organizationId,
      ...(templateIds ? { templateId: { in: [...templateIds] } } : {}),
    },
    select: { templateId: true, fillMode: true, defaultAssigneeId: true, bonusAmountKopecks: true },
  });
  return new Map(
    rows.map((row) => [
      row.templateId,
      { fillMode: row.fillMode, defaultAssigneeId: row.defaultAssigneeId, bonusAmountKopecks: row.bonusAmountKopecks },
    ]),
  );
}

/** Шаблоны с настройками организации (список целиком). */
export async function applyOrgJournalOverrides<T extends TemplateSettings & { id: string }>(
  organizationId: string,
  templates: readonly T[],
): Promise<T[]> {
  if (templates.length === 0) return [];
  const overrides = await loadOrgJournalOverrides(
    organizationId,
    templates.map((template) => template.id),
  );
  return templates.map((template) => withOrgJournalOverride(template, overrides.get(template.id)));
}

/** Бонус за заполнение журнала в организации (копейки). */
export async function orgJournalBonusKopecks(
  organizationId: string,
  template: { id: string; bonusAmountKopecks: number },
): Promise<number> {
  const override = (await loadOrgJournalOverrides(organizationId, [template.id])).get(template.id);
  return override?.bonusAmountKopecks ?? template.bonusAmountKopecks;
}

/** Сохранить настройку журнала организации; шаблон не трогаем. */
export async function saveOrgJournalSetting(
  organizationId: string,
  templateId: string,
  data: Partial<OrgJournalOverride>,
): Promise<void> {
  await db.organizationJournalSetting.upsert({
    where: { organizationId_templateId: { organizationId, templateId } },
    create: { organizationId, templateId, ...data },
    update: data,
  });
}

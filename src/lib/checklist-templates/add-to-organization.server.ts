import { db } from "@/lib/db";
import { checklistDefinitionSchema } from "@/lib/custom-checklists";
import { typicalChecklistCopy, type TypicalChecklistKey } from "@/lib/checklist-templates";

/**
 * «Добавить типовой шаблон в организацию»: независимая копия в
 * `ChecklistTemplate`. Если у организации уже есть живой (не в архиве)
 * шаблон с тем же названием, второй не создаём — возвращаем имеющийся:
 * повторное нажатие не должно плодить одинаковые шаблоны.
 */
export async function addTypicalChecklistToOrganization(
  organizationId: string,
  key: TypicalChecklistKey,
): Promise<{ template: { id: string; title: string; version: number }; created: boolean }> {
  const copy = typicalChecklistCopy(key);
  // Та же проверка, что у шаблона из конструктора: в базу — только валидное.
  const definition = checklistDefinitionSchema.parse(copy.definition);
  return db.$transaction(async (tx) => {
    const existing = await tx.checklistTemplate.findFirst({
      where: { organizationId, title: copy.title, archived: false },
      select: { id: true, title: true, version: true },
    });
    if (existing) return { template: existing, created: false };
    const template = await tx.checklistTemplate.create({
      data: { organizationId, title: copy.title, definition },
      select: { id: true, title: true, version: true },
    });
    return { template, created: true };
  });
}

/** Названия типовых шаблонов, которые у организации уже есть (не в архиве). */
export async function addedTypicalChecklistTitles(organizationId: string, titles: string[]): Promise<Set<string>> {
  const rows = await db.checklistTemplate.findMany({
    where: { organizationId, archived: false, title: { in: titles } },
    select: { title: true },
  });
  return new Set(rows.map((row) => row.title));
}

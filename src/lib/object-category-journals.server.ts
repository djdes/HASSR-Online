import { checkJournalLimit } from "@/lib/billing.server";
import { isOfficeBuilding } from "@/lib/building-scope";
import { db } from "@/lib/db";
import { parseDisabledCodes, setDisabledJournalCodes } from "@/lib/disabled-journals";
import { planObjectCategoryJournals } from "@/lib/object-category-journals";
import type { ObjectCategory } from "@/lib/object-categories";
import { planJournalSetWrite } from "@/lib/point-journals";

/**
 * Сфера объекта выбрана (создание) или сменилась — основная сфера
 * организации и наборы журналов по `planObjectCategoryJournals`. Включение
 * журналов не обходит тариф: не помещается в лимит журналов — набор не
 * трогаем (сфера объекта всё равно сохранена). Возвращает, что изменилось.
 */
export async function applyObjectCategoryJournals(args: {
  organizationId: string;
  buildingId: string;
  category: ObjectCategory;
  reason: "create" | "change";
}): Promise<{ organizationSphere: boolean; journals: boolean; limited: boolean }> {
  const [organization, buildings] = await Promise.all([
    db.organization.findUnique({
      where: { id: args.organizationId },
      select: { type: true, disabledJournalCodes: true },
    }),
    db.building.findMany({
      where: { organizationId: args.organizationId },
      select: { id: true, kind: true, disabledJournalCodes: true },
    }),
  ]);
  const building = buildings.find((item) => item.id === args.buildingId);
  if (!organization || !building || isOfficeBuilding(building)) {
    return { organizationSphere: false, journals: false, limited: false };
  }
  const orgDisabled = [...parseDisabledCodes(organization.disabledJournalCodes)];
  const plan = planObjectCategoryJournals({
    organizationSphere: organization.type,
    organizationDisabled: orgDisabled,
    category: args.category,
    reason: args.reason,
    objectDisabled: building.disabledJournalCodes === null ? null : [...parseDisabledCodes(building.disabledJournalCodes)],
  });

  if (plan.organizationSphere) {
    await db.organization.update({
      where: { id: args.organizationId },
      data: { type: plan.organizationSphere },
    });
  }

  const target = plan.objectDisabled ? args.buildingId : null;
  const codes = plan.objectDisabled ?? plan.organizationDisabled;
  if (!codes) return { organizationSphere: Boolean(plan.organizationSphere), journals: false, limited: false };

  // Лимит тарифа считается по набору организации после записи.
  const sets = {
    orgDisabled,
    buildings: buildings.map((item) => ({
      id: item.id,
      disabled: item.disabledJournalCodes === null ? null : [...parseDisabledCodes(item.disabledJournalCodes)],
    })),
  };
  const orgAfter = planJournalSetWrite(sets, target, codes).orgDisabled;
  const limit = await checkJournalLimit(args.organizationId, orgAfter, { source: "settings/buildings:sphere" });
  if (!limit.ok) return { organizationSphere: Boolean(plan.organizationSphere), journals: false, limited: true };
  await setDisabledJournalCodes(args.organizationId, codes, target);
  return { organizationSphere: Boolean(plan.organizationSphere), journals: true, limited: false };
}

import { db } from "@/lib/db";
import { brakerageDishesOn } from "@/lib/badge/today";
import { FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE } from "@/lib/finished-product-document";
import { orgTodayKey } from "@/lib/timezone";
import { mergeServingDishes, type ServingDish } from "@/lib/serving-dishes";

/**
 * Блюда на раздаче для проверки (`mergeServingDishes`): сегодняшний бракераж
 * точки проверки (документы точки и общие, без точки) и готовая продукция
 * справочника — у `Product` точки нет, справочник общий.
 *
 * `points` — точки человека (`visibleObjectBuildingIds`): null — все.
 */
export async function loadServingDishes(input: {
  organizationId: string;
  points: string[] | null;
  now?: Date;
}): Promise<ServingDish[]> {
  const now = input.now ?? new Date();
  const organization = await db.organization.findUnique({ where: { id: input.organizationId }, select: { timezone: true } });
  const today = orgTodayKey(organization?.timezone || undefined, now);
  const dayStart = new Date(`${today}T00:00:00.000Z`);
  const [documents, products] = await Promise.all([
    db.journalDocument.findMany({
      where: {
        organizationId: input.organizationId,
        status: "active",
        template: { code: FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE },
        dateFrom: { lte: dayStart },
        dateTo: { gte: dayStart },
        ...(input.points ? { OR: [{ buildingId: { in: input.points } }, { buildingId: null }] } : {}),
      },
      orderBy: { dateFrom: "desc" },
      take: 20,
      select: { config: true },
    }),
    db.product.findMany({
      where: { organizationId: input.organizationId, isActive: true, kind: "finished" },
      orderBy: { name: "asc" },
      take: 500,
      select: { name: true, servingTemp: true },
    }),
  ]);
  const brakerage = documents.flatMap((document) =>
    brakerageDishesOn(document.config, today)
      .sort((left, right) => (left.time ?? "").localeCompare(right.time ?? ""))
      .map((dish) => dish.name),
  );
  return mergeServingDishes({ brakerage, directory: products });
}

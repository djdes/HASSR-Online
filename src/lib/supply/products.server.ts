import { db } from "@/lib/db";
import { parseProductUnitInput } from "@/lib/settings-products-presentation";

/**
 * Новые товары из учётной системы — в справочник продуктов. Только
 * недостающие (по имени без учёта регистра): заведённые руками продукты,
 * их сроки и условия хранения не трогаем. Единица — кодом, как в
 * справочнике («кг» → «kg»).
 */
export async function addMissingProducts(
  organizationId: string,
  items: Array<{ name: string; unit: string | null }>,
): Promise<number> {
  if (items.length === 0) return 0;
  const existing = await db.product.findMany({ where: { organizationId }, select: { name: true } });
  const known = new Set(existing.map((product) => product.name.trim().toLocaleLowerCase("ru")));
  const fresh = items.filter((item) => !known.has(item.name.trim().toLocaleLowerCase("ru"))).slice(0, 2000);
  if (fresh.length === 0) return 0;
  const created = await db.product.createMany({
    data: fresh.map((item) => ({
      organizationId,
      name: item.name.trim().slice(0, 200),
      unit: item.unit ? parseProductUnitInput(item.unit, "ru") : "kg",
    })),
  });
  return created.count;
}

import { db } from "@/lib/db";
import { resolveDishPoolOrgIds } from "@/lib/dish-pool";
import { ORG_DIRECTORY_KINDS, type OrgDirectoryKind } from "@/lib/org-directory";

/**
 * Чтение общего справочника организации. Серверная часть: только здесь
 * известно, из каких таблиц собирается каждый вид.
 *
 * Поставщики и изготовители отдельной таблицы не имеют — собираем их из
 * справочника продуктов и принятых партий. Блюда берём из памяти
 * наименований (`NameSuggestion`): это то, что люди уже вписывали руками.
 */

const LIMIT = 1000;

export async function loadOrgDirectory(
  organizationId: string,
  kind: OrgDirectoryKind
): Promise<string[]> {
  if (kind === "product") {
    const rows = await db.product.findMany({
      where: { organizationId, isActive: true },
      select: { name: true },
      orderBy: { name: "asc" },
      take: LIMIT,
    });
    return unique(rows.map((row) => row.name));
  }

  if (kind === "supplier") {
    const [fromProducts, fromBatches] = await Promise.all([
      db.product.findMany({
        where: { organizationId, isActive: true, supplier: { not: null } },
        select: { supplier: true },
        distinct: ["supplier"],
        take: LIMIT,
      }),
      db.batch.findMany({
        where: { organizationId, supplier: { not: null } },
        select: { supplier: true },
        distinct: ["supplier"],
        take: LIMIT,
      }),
    ]);
    return unique([
      ...fromProducts.map((row) => row.supplier ?? ""),
      ...fromBatches.map((row) => row.supplier ?? ""),
    ]);
  }

  if (kind === "manufacturer") {
    // Отдельного поля «изготовитель» у продукта нет: в справочнике его
    // роль исполняет поставщик, поэтому берём тот же столбец.
    const rows = await db.product.findMany({
      where: { organizationId, isActive: true, supplier: { not: null } },
      select: { supplier: true },
      distinct: ["supplier"],
      take: LIMIT,
    });
    return unique(rows.map((row) => row.supplier ?? ""));
  }

  // Блюда — с общим справочником по служебному коду (dish-pool.ts).
  const poolIds = await resolveDishPoolOrgIds(organizationId);
  const rows = await db.nameSuggestion.findMany({
    where: { organizationId: { in: poolIds }, scope: "dish" },
    select: { value: true },
    orderBy: [{ useCount: "desc" }, { lastUsedAt: "desc" }],
    take: LIMIT,
  });
  return unique(rows.map((row) => row.value));
}

/** Все виды сразу — для страниц, которым нужен весь справочник. */
export async function loadOrgDirectoryAll(
  organizationId: string
): Promise<Record<OrgDirectoryKind, string[]>> {
  const entries = await Promise.all(
    ORG_DIRECTORY_KINDS.map(async (kind) => [kind, await loadOrgDirectory(organizationId, kind)] as const)
  );
  return Object.fromEntries(entries) as Record<OrgDirectoryKind, string[]>;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.replace(/\s+/g, " ").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

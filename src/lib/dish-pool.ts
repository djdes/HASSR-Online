import { db } from "@/lib/db";
import { generateServiceCode, normalizeServiceCode } from "@/lib/dish-pool-code";

/**
 * Общий справочник блюд между организациями (владелец, 2026-09-21: «общий
 * пул» — все организации с одним кодом видят и пополняют общий список,
 * после отвязки у организации остаются её собственные блюда).
 *
 * Хранение: блюда по-прежнему в `NameSuggestion` своей организации;
 * общий список — это чтение `NameSuggestion(scope="dish")` всех
 * организаций пула. Пул — организации с одним «действующим кодом»:
 * `linkedServiceCode ?? serviceCode`.
 */

const POOL_MAX_ORGS = 50;

export async function ensureServiceCode(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { serviceCode: true } });
  if (org?.serviceCode) return org.serviceCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateServiceCode();
    try {
      await db.organization.update({ where: { id: organizationId }, data: { serviceCode: code } });
      return code;
    } catch {
      // Совпадение с чужим кодом (unique) — пробуем другой.
    }
  }
  throw new Error("Не удалось выдать служебный код");
}

/** Организации пула (включая свою). Без привязки и без кода — только своя. */
export async function resolveDishPoolOrgIds(organizationId: string): Promise<string[]> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { serviceCode: true, linkedServiceCode: true },
  });
  const code = org?.linkedServiceCode ?? org?.serviceCode ?? null;
  if (!code) return [organizationId];
  const members = await db.organization.findMany({
    where: {
      OR: [{ linkedServiceCode: code }, { serviceCode: code, linkedServiceCode: null }],
    },
    select: { id: true },
    take: POOL_MAX_ORGS,
  });
  const ids = members.map((member) => member.id);
  return ids.includes(organizationId) ? ids : [organizationId, ...ids];
}

export type DishPoolInfo = {
  ownCode: string;
  linkedCode: string | null;
  /** Организация — владелец кода, к которому привязались. */
  linkedOrganizationName: string | null;
  /** Сколько организаций в общем списке (включая свою). */
  poolSize: number;
};

export async function getDishPoolInfo(organizationId: string): Promise<DishPoolInfo> {
  const ownCode = await ensureServiceCode(organizationId);
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { linkedServiceCode: true } });
  const linkedCode = org?.linkedServiceCode ?? null;
  const owner = linkedCode
    ? await db.organization.findFirst({ where: { serviceCode: linkedCode }, select: { name: true } })
    : null;
  const pool = await resolveDishPoolOrgIds(organizationId);
  return { ownCode, linkedCode, linkedOrganizationName: owner?.name ?? null, poolSize: pool.length };
}

export type LinkPreview = { code: string; organizationName: string; poolSize: number };

/** Кому принадлежит код и сколько организаций уже в его общем списке. */
export async function previewDishPoolLink(organizationId: string, input: unknown): Promise<LinkPreview | { error: string }> {
  const code = normalizeServiceCode(input);
  if (!code) return { error: "Код — 10 символов, например ABCDE-FGH23" };
  const owner = await db.organization.findFirst({
    where: { serviceCode: code },
    select: { id: true, name: true, linkedServiceCode: true },
  });
  if (!owner) return { error: "Организации с таким кодом нет. Проверьте код." };
  if (owner.id === organizationId) return { error: "Это код вашей организации — его вводят другие организации" };
  // Код, который сам привязан к чужой базе, ведёт в ту же базу.
  const root = owner.linkedServiceCode ?? code;
  const members = await db.organization.count({
    where: { OR: [{ linkedServiceCode: root }, { serviceCode: root, linkedServiceCode: null }] },
  });
  return { code: root, organizationName: owner.name, poolSize: members };
}

export async function linkDishPool(organizationId: string, input: unknown): Promise<LinkPreview | { error: string }> {
  const preview = await previewDishPoolLink(organizationId, input);
  if ("error" in preview) return preview;
  await ensureServiceCode(organizationId);
  await db.organization.update({ where: { id: organizationId }, data: { linkedServiceCode: preview.code } });
  return preview;
}

export async function unlinkDishPool(organizationId: string): Promise<void> {
  await db.organization.update({ where: { id: organizationId }, data: { linkedServiceCode: null } });
}

import { db } from "@/lib/db";
import { generateServiceCode, normalizeServiceCode } from "@/lib/dish-pool-code";
import { dishShareOrgIds } from "@/lib/dish-pool-share";
import { journalPointsOf } from "@/lib/master-pool-points";

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
    if (!(await isCodeFree(code))) continue;
    try {
      await db.organization.update({ where: { id: organizationId }, data: { serviceCode: code } });
      return code;
    } catch {
      // Совпадение с чужим кодом (unique) — пробуем другой.
    }
  }
  throw new Error("Не удалось выдать служебный код");
}

/** Код свободен: ни у организации, ни у точки (мастер ищет код и там, и там). */
async function isCodeFree(code: string): Promise<boolean> {
  const [org, building] = await Promise.all([
    db.organization.findUnique({ where: { serviceCode: code }, select: { id: true } }),
    db.building.findUnique({ where: { serviceCode: code }, select: { id: true } }),
  ]);
  return !org && !building;
}

/**
 * Код журнала точки (2026-10-28): у каждой точки со своими журналами свой
 * код — мастер-кабинет подключает по нему эту точку, а не организацию.
 */
export async function ensureBuildingServiceCode(buildingId: string): Promise<string> {
  const building = await db.building.findUnique({ where: { id: buildingId }, select: { serviceCode: true } });
  if (building?.serviceCode) return building.serviceCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateServiceCode();
    if (!(await isCodeFree(code))) continue;
    try {
      // Параллельный запрос мог выдать код раньше — не перезаписываем его.
      const { count } = await db.building.updateMany({ where: { id: buildingId, serviceCode: null }, data: { serviceCode: code } });
      if (count > 0) return code;
      const current = await db.building.findUnique({ where: { id: buildingId }, select: { serviceCode: true } });
      if (current?.serviceCode) return current.serviceCode;
    } catch {
      // Совпадение с чужим кодом (unique) — пробуем другой.
    }
  }
  throw new Error("Не удалось выдать код журнала точки");
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

/**
 * Организации пула, чьи названия блюд подсказываются организации (серия C1,
 * Р7.4): в пуле мастер-кабинета — только своей компании и компании кабинета
 * (`dish-pool-share.ts`). Состав пула (`resolveDishPoolOrgIds`) не меняется:
 * кабинет по-прежнему раздаёт меню и сырьё всем своим объектам.
 */
export async function resolveDishSuggestionOrgIds(organizationId: string): Promise<string[]> {
  const ids = await resolveDishPoolOrgIds(organizationId);
  if (ids.length <= 1) return ids;
  const orgs = await db.organization.findMany({
    where: { id: { in: ids } },
    select: { id: true, accountId: true, kind: true, serviceCode: true, linkedServiceCode: true },
  });
  return dishShareOrgIds(organizationId, ids, orgs);
}

export type DishPoolInfo = {
  ownCode: string;
  linkedCode: string | null;
  /** Организация — владелец кода, к которому привязались. */
  linkedOrganizationName: string | null;
  /** Сколько организаций в общем списке (включая свою). */
  poolSize: number;
  /** Код — точки (у организации журналы по точкам): её название; иначе null — код организации. */
  pointName: string | null;
};

export async function getDishPoolInfo(organizationId: string, buildingId?: string | null): Promise<DishPoolInfo> {
  // Точка, подключённая к пулу (слитая организация), — пул точки.
  const building = buildingId
    ? await db.building.findFirst({
        where: { id: buildingId, organizationId },
        select: { id: true, name: true, kind: true, linkedServiceCode: true, organization: { select: { perLocationJournals: true } } },
      })
    : null;
  // Журналы по точкам — у точки свой код журнала, иначе код организации.
  const point = building && journalPointsOf(building.organization, [building]).length > 0 ? building : null;
  const ownCode = point ? await ensureBuildingServiceCode(point.id) : await ensureServiceCode(organizationId);
  const pointName = point?.name ?? null;
  if (building?.linkedServiceCode) {
    const code = building.linkedServiceCode;
    const [owner, orgs, buildings] = await Promise.all([
      db.organization.findFirst({ where: { serviceCode: code }, select: { name: true, accountId: true } }),
      db.organization.count({ where: { OR: [{ linkedServiceCode: code }, { serviceCode: code, linkedServiceCode: null }] } }),
      db.building.count({ where: { linkedServiceCode: code } }),
    ]);
    return { ownCode, linkedCode: code, linkedOrganizationName: await poolOwnerName(organizationId, code, owner), poolSize: orgs + buildings, pointName };
  }
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { linkedServiceCode: true } });
  const linkedCode = org?.linkedServiceCode ?? null;
  const owner = linkedCode
    ? await db.organization.findFirst({ where: { serviceCode: linkedCode }, select: { name: true, accountId: true } })
    : null;
  // Сколько организаций в общем списке блюд этой организации (Р7.4: без других компаний).
  const pool = await resolveDishSuggestionOrgIds(organizationId);
  return { ownCode, linkedCode, linkedOrganizationName: linkedCode ? await poolOwnerName(organizationId, linkedCode, owner) : null, poolSize: pool.length, pointName };
}

/**
 * Название базы, к которой подключена организация, — хозяин кода. Хозяин из
 * другой компании (компанию к меню и сырью кабинета подключил обмен, серия C1)
 * — название мастер-кабинета пула: об организациях владельца кабинета
 * компания знает только его название.
 */
async function poolOwnerName(
  organizationId: string,
  code: string,
  owner: { name: string; accountId: string | null } | null
): Promise<string | null> {
  if (!owner) return null;
  const self = await db.organization.findUnique({ where: { id: organizationId }, select: { accountId: true } });
  if (!self?.accountId || !owner.accountId || owner.accountId === self.accountId) return owner.name;
  const cabinet = await db.organization.findFirst({
    where: { kind: "directory", OR: [{ linkedServiceCode: code }, { serviceCode: code, linkedServiceCode: null }] },
    orderBy: { createdAt: "asc" },
    select: { name: true },
  });
  return cabinet?.name ?? owner.name;
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

import { db } from "@/lib/db";
import { listMasterUsers, type MasterCabinetUser } from "@/lib/master-cabinet";
import { poolCodeOf } from "@/lib/master-cabinet-choice";
import { listPoolOrganizations, MASTER_ORG_KIND, poolObjectId } from "@/lib/master-directory";
import { journalPointsOf, orgObjectsInPool, poolCodeOfObject } from "@/lib/master-pool-points";
import { assertOrgMembership } from "@/lib/organization-access";

/**
 * Страница организации «Мастер-кабинет» (скан 99 от 2026-10-28): «должен
 * быть функционал — показано, какие мастер-кабинеты уже есть; возможность
 * добавить торговую точку; возможность добавить внешнего сотрудника —
 * оператора МК». Кабинеты страницы — кабинеты аккаунта организации и
 * кабинеты, к которым подключена она сама или её точки (у сети «Сады» и
 * «Школы» — оба).
 */

export type OrgCabinetObject = {
  /** id объекта кабинета (`poolObjectId`). */
  objectId: string;
  /** Точка; null — организация целиком (журналы не по точкам). */
  buildingId: string | null;
  name: string;
  address: string | null;
  /** В кабинете вместе с организацией (организация подключена целиком). */
  whole: boolean;
  canDisconnect: boolean;
};

export type OrgMasterCabinet = {
  id: string;
  name: string;
  /** Кабинет аккаунта этой организации (его людьми управляет владелец аккаунта). */
  ownAccount: boolean;
  /** Сколько объектов (точек и организаций) получают меню и сырьё из кабинета. */
  objectsCount: number;
  /** Точки этой организации в кабинете. */
  objects: OrgCabinetObject[];
  /** Операторы — люди кабинета. */
  operators: MasterCabinetUser[];
  /** Смотрящий может переключиться в кабинет. */
  viewerCanOpen: boolean;
};

/** Что можно подключить: точка (или организация целиком) и её кабинет сейчас. */
export type OrgConnectable = {
  buildingId: string | null;
  name: string;
  address: string | null;
  cabinetId: string | null;
  cabinetName: string | null;
};

export type OrgMasterCabinetsView = {
  organizationName: string;
  cabinets: OrgMasterCabinet[];
  connectable: OrgConnectable[];
  /** Журналы по точкам: подключаются точки, а не организация. */
  byPoints: boolean;
  /** Смотрящий — владелец аккаунта: создаёт кабинеты и управляет их людьми. */
  viewerIsOwner: boolean;
  isDemo: boolean;
};

const EMPTY: Omit<OrgMasterCabinetsView, "organizationName" | "isDemo"> = {
  cabinets: [],
  connectable: [],
  byPoints: false,
  viewerIsOwner: false,
};

export async function loadOrgMasterCabinets(organizationId: string, viewerUserId: string): Promise<OrgMasterCabinetsView> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      accountId: true,
      isDemo: true,
      perLocationJournals: true,
      serviceCode: true,
      linkedServiceCode: true,
      buildings: {
        select: { id: true, name: true, address: true, kind: true, linkedServiceCode: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
    },
  });
  if (!org) return { ...EMPTY, organizationName: "", isDemo: false };

  const ownerAccount = org.accountId
    ? await db.account.findUnique({ where: { id: org.accountId }, select: { ownerUserId: true } })
    : null;
  const viewerIsOwner = ownerAccount?.ownerUserId === viewerUserId;

  // Кабинеты аккаунта и кабинеты кодов, к которым подключены организация и её точки.
  const codes = [
    ...new Set(
      [poolCodeOf(org), ...org.buildings.map((building) => building.linkedServiceCode)].filter(
        (code): code is string => Boolean(code)
      )
    ),
  ];
  const where = [
    ...(org.accountId ? [{ accountId: org.accountId }] : []),
    ...(codes.length > 0
      ? [{ linkedServiceCode: { in: codes } }, { serviceCode: { in: codes }, linkedServiceCode: null }]
      : []),
  ];
  const cabinets =
    where.length > 0
      ? await db.organization.findMany({
          where: { kind: MASTER_ORG_KIND, OR: where },
          select: { id: true, name: true, accountId: true, serviceCode: true, linkedServiceCode: true },
          orderBy: { createdAt: "asc" },
        })
      : [];

  // Кабинет кода — самый ранний (как `findPoolMasterOrgId`).
  const cabinetByCode = new Map<string, { id: string; name: string }>();
  for (const cabinet of cabinets) {
    const code = poolCodeOf(cabinet);
    if (code && !cabinetByCode.has(code)) cabinetByCode.set(code, { id: cabinet.id, name: cabinet.name });
  }
  const cabinetCodes = new Set(cabinetByCode.keys());

  const byPoints = journalPointsOf(org, org.buildings).length > 0;
  const connectable: OrgConnectable[] = (byPoints ? journalPointsOf(org, org.buildings) : [null]).map((building) => {
    const code = poolCodeOfObject(org, building, cabinetCodes);
    const cabinet = code ? cabinetByCode.get(code) ?? null : null;
    return {
      buildingId: building?.id ?? null,
      name: building?.name ?? org.name,
      address: building?.address ?? null,
      cabinetId: cabinet?.id ?? null,
      cabinetName: cabinet?.name ?? null,
    };
  });

  const loaded = await Promise.all(
    cabinets.map(async (cabinet): Promise<OrgMasterCabinet> => {
      const code = poolCodeOf(cabinet);
      const [pool, operators, viewerCanOpen] = await Promise.all([
        listPoolOrganizations(cabinet.id),
        listMasterUsers(cabinet.id),
        assertOrgMembership(viewerUserId, cabinet.id),
      ]);
      return {
        id: cabinet.id,
        name: cabinet.name,
        ownAccount: Boolean(org.accountId) && cabinet.accountId === org.accountId,
        objectsCount: pool.length,
        objects: orgObjectsInPool(org, org.buildings, code).map((object) => ({
          objectId: poolObjectId(org.id, object.building?.id),
          buildingId: object.building?.id ?? null,
          name: object.building?.name ?? org.name,
          address: object.building?.address ?? null,
          whole: object.whole,
          canDisconnect: object.canDisconnect,
        })),
        operators,
        viewerCanOpen,
      };
    })
  );
  // Кабинеты с точками организации — первыми, дальше по названию.
  loaded.sort(
    (a, b) => Number(b.objects.length > 0) - Number(a.objects.length > 0) || a.name.localeCompare(b.name, "ru")
  );

  return {
    organizationName: org.name,
    cabinets: loaded,
    connectable,
    byPoints,
    viewerIsOwner,
    isDemo: org.isDemo,
  };
}

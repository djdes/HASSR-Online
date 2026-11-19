import { normalizePhone } from "@/lib/phone";
import { ensureRoomMirrorArea, renameRoomMirrorArea } from "@/lib/area-building-sync";
import { checkPointsForCreation } from "@/lib/billing.server";
import { OFFICE_BUILDING_KIND } from "@/lib/building-scope";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  applyEquipmentNormToColdConfig,
  normalizeColdEquipmentDocumentConfig,
} from "@/lib/cold-equipment-document";
import { db } from "@/lib/db";
import {
  naturalKey,
  pickExchangeFields,
  rowHash,
  type ExchangeEntity,
  type ExchangeFields,
  type ExchangeKind,
} from "@/lib/directory-exchange/kinds";
import type { ExchangeRow } from "@/lib/directory-exchange/plan";
import { isFryerEquipmentType } from "@/lib/fryer-oil-equipment-link";
import { syncFryerOilDocumentsSafe } from "@/lib/fryer-oil-equipment-sync";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { guessRoomKind } from "@/lib/orphan-areas";
import { DEFAULT_PRODUCT_KIND, isProductKind, isServingTemp } from "@/lib/product-kinds";
import { ROOM_KINDS, type RoomKind } from "@/lib/room-kinds";
import { createStaffMember } from "@/lib/staff-create";
import { normalizeWeeklyDaysOff } from "@/lib/staff-days-off";
import { tryAutolinkTasksflowByPhone } from "@/lib/tasksflow-autolink";
import { isManagementRole } from "@/lib/user-roles";
import { syncUvDocumentPoints } from "@/lib/uv-document-points";
import { isUvLampEquipment } from "@/lib/uv-lamp";

/**
 * Обмен справочниками — работа с базой по каждой сущности: чтение строк
 * организации в виде, понятном планировщику, и применение операций
 * «создать» / «обновить».
 *
 * Создание идёт теми же правилами, что и у ручного ввода: сотрудник — через
 * `createStaffMember` (места тарифа, доступ к журналам), объект — через
 * `checkPointsForCreation` (точки тарифа), помещение заводит цех-зеркало,
 * цех — помещение-зеркало. Отказ тарифа и совпадение названий — не ошибка
 * обмена, а пропуск со счётчиком.
 *
 * Правило Р4 держится здесь: читаются только линейные сотрудники без входа,
 * должности категории staff и объекты без офиса; при записи не трогаются
 * почта, пароль, роль, Telegram, датчики (`tuyaDeviceId`) и ответственные.
 */

export type EntityRow = ExchangeRow & {
  name: string;
  /** Подпись к записи в окне переноса: должность, объект, цех, поставщик. */
  detail: string | null;
  fields: ExchangeFields;
  /** Родитель в своей организации (должность, объект, цех). */
  parentId: string | null;
  /** Группа родителя — общая для участников обмена. */
  parentGroupId: string | null;
};

/** Группа родителя по его id в этой организации; null — родитель не обменивается. */
export type ParentGroupLookup = (parentId: string) => string | null;

export type CreateOutcome = { status: "created"; id: string } | { status: "limit" } | { status: "conflict" };
export type UpdateOutcome = { status: "updated" } | { status: "conflict" } | { status: "missing" };

const STAFF_CATEGORY = "staff";
const EXCHANGE_SOURCE = "directory-exchange";
const AUTO_AREA_DESCRIPTION = "Авто-создан из Помещения";
/** Цеха и оборудование офиса не переносятся вместе с самим офисом. */
const NOT_OFFICE_AREA_WHERE = {
  OR: [{ buildingId: null }, { building: { is: { kind: { not: OFFICE_BUILDING_KIND } } } }],
};

function text(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isUniqueConflict(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

/**
 * Описание цеха, заведённого зеркалом помещения, — служебное и содержит id
 * помещения своей организации. В обмен оно не идёт: иначе одинаковые цеха
 * считались бы разными.
 */
function exchangedAreaDescription(description: string | null): string | null {
  const value = text(description, 1000);
  return value && !value.startsWith(AUTO_AREA_DESCRIPTION) ? value : null;
}

/** Единственный объект организации (без офиса) — место цеха без объекта. */
async function soleObjectId(organizationId: string): Promise<string | null> {
  const objects = await db.building.findMany({
    where: { organizationId, kind: { not: OFFICE_BUILDING_KIND } },
    select: { id: true },
    take: 2,
  });
  return objects.length === 1 ? objects[0].id : null;
}

function makeRow(
  entity: ExchangeEntity,
  input: {
    id: string;
    fields: ExchangeFields;
    parentId?: string | null;
    parentGroupId?: string | null;
    updatedAt?: Date | null;
    detail?: string | null;
  },
): EntityRow {
  const fields = pickExchangeFields(entity, input.fields);
  const parentGroupId = input.parentGroupId ?? null;
  return {
    id: input.id,
    key: naturalKey(entity, fields, parentGroupId),
    hash: rowHash(entity, fields, parentGroupId),
    updatedAt: input.updatedAt ?? null,
    name: typeof fields.name === "string" ? fields.name : "",
    detail: input.detail ?? null,
    fields,
    parentId: input.parentId ?? null,
    parentGroupId,
  };
}

/* ───────────────────────── чтение ───────────────────────── */

/**
 * Строки сущности у организации, старые раньше. Родитель переводится в
 * группу родителя по текущим связям (`parentGroupOf`).
 */
export async function loadEntityRows(
  entity: ExchangeEntity,
  organizationId: string,
  parentGroupOf: ParentGroupLookup = () => null,
): Promise<EntityRow[]> {
  switch (entity) {
    case "position": {
      const rows = await db.jobPosition.findMany({
        where: { organizationId, categoryKey: STAFF_CATEGORY },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true, updatedAt: true },
      });
      return rows.map((row) => makeRow(entity, { id: row.id, fields: { name: row.name }, updatedAt: row.updatedAt }));
    }
    case "staff": {
      const rows = await db.user.findMany({
        where: {
          organizationId,
          ...ORG_ROSTER_WHERE,
          passwordHash: "",
          jobPosition: { is: { categoryKey: STAFF_CATEGORY } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          phone: true,
          role: true,
          weeklyDaysOff: true,
          jobPositionId: true,
          jobPosition: { select: { name: true } },
        },
      });
      return rows
        .filter((row) => !isManagementRole(row.role))
        .map((row) =>
          makeRow(entity, {
            id: row.id,
            // Телефон сравниваем в едином виде: «8 (999)…» и «+7999…» — одно и то же,
            // а номер, который не разобрать, не считается сведением вовсе.
            fields: { name: row.name, phone: normalizePhone(row.phone), weeklyDaysOff: normalizeWeeklyDaysOff(row.weeklyDaysOff) },
            parentId: row.jobPositionId,
            parentGroupId: row.jobPositionId ? parentGroupOf(row.jobPositionId) : null,
            detail: row.jobPosition?.name ?? null,
          }),
        );
    }
    case "building": {
      const rows = await db.building.findMany({
        where: { organizationId, kind: { not: OFFICE_BUILDING_KIND } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true, address: true, updatedAt: true },
      });
      return rows.map((row) =>
        makeRow(entity, {
          id: row.id,
          fields: { name: row.name, address: row.address },
          updatedAt: row.updatedAt,
          detail: text(row.address),
        }),
      );
    }
    case "room": {
      const rows = await db.room.findMany({
        where: { building: { organizationId, kind: { not: OFFICE_BUILDING_KIND } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          kind: true,
          sortOrder: true,
          buildingId: true,
          updatedAt: true,
          building: { select: { name: true } },
        },
      });
      return rows.map((row) =>
        makeRow(entity, {
          id: row.id,
          fields: { name: row.name, kind: row.kind, sortOrder: row.sortOrder },
          parentId: row.buildingId,
          parentGroupId: parentGroupOf(row.buildingId),
          updatedAt: row.updatedAt,
          detail: row.building.name,
        }),
      );
    }
    case "area": {
      const [rows, sole] = await Promise.all([
        db.area.findMany({
          where: { organizationId, ...NOT_OFFICE_AREA_WHERE },
          // У цеха нет даты создания; cuid растёт со временем.
          orderBy: { id: "asc" },
          select: { id: true, name: true, description: true, buildingId: true, building: { select: { name: true } } },
        }),
        soleObjectId(organizationId),
      ]);
      return rows.map((row) => {
        // Цех без объекта там, где объект один, — цех этого объекта: так он
        // находит «свой» цех у соседней организации, а не становится вторым.
        const buildingId = row.buildingId ?? sole;
        return makeRow(entity, {
          id: row.id,
          fields: { name: row.name, description: exchangedAreaDescription(row.description) },
          parentId: row.buildingId,
          parentGroupId: buildingId ? parentGroupOf(buildingId) : null,
          detail: row.building?.name ?? null,
        });
      });
    }
    case "equipment": {
      const rows = await db.equipment.findMany({
        where: { area: { organizationId, ...NOT_OFFICE_AREA_WHERE } },
        orderBy: { id: "asc" },
        select: {
          id: true,
          name: true,
          type: true,
          serialNumber: true,
          tempMin: true,
          tempMax: true,
          lampModel: true,
          lampLifetimeHours: true,
          areaId: true,
          area: { select: { name: true } },
        },
      });
      return rows.map((row) =>
        makeRow(entity, {
          id: row.id,
          fields: {
            name: row.name,
            type: row.type,
            serialNumber: row.serialNumber,
            tempMin: row.tempMin,
            tempMax: row.tempMax,
            lampModel: row.lampModel,
            lampLifetimeHours: row.lampLifetimeHours,
          },
          parentId: row.areaId,
          parentGroupId: parentGroupOf(row.areaId),
          detail: row.area.name,
        }),
      );
    }
    case "product": {
      const rows = await db.product.findMany({
        where: { organizationId, isActive: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          supplier: true,
          barcode: true,
          unit: true,
          category: true,
          kind: true,
          storageTemp: true,
          storageConditions: true,
          shelfLifeDays: true,
          shelfLifeHours: true,
          servingTemp: true,
          updatedAt: true,
        },
      });
      return rows.map(({ id, updatedAt, ...fields }) =>
        makeRow(entity, { id, fields, updatedAt, detail: text(fields.supplier) ?? text(fields.category) }),
      );
    }
  }
}

/** Сколько записей списка у организации — для окна «Связать или перенести». */
export async function countExchangeRecords(organizationId: string): Promise<Record<ExchangeKind, number>> {
  const [products, staff, objects, equipment] = await Promise.all([
    db.product.count({ where: { organizationId, isActive: true } }),
    loadEntityRows("staff", organizationId).then((rows) => rows.length),
    db.building.count({ where: { organizationId, kind: { not: OFFICE_BUILDING_KIND } } }),
    db.equipment.count({ where: { area: { organizationId, ...NOT_OFFICE_AREA_WHERE } } }),
  ]);
  return { products, staff, objects, equipment };
}

/* ───────────────────────── создание ───────────────────────── */

function productData(fields: ExchangeFields) {
  const kind = isProductKind(fields.kind) ? fields.kind : DEFAULT_PRODUCT_KIND;
  return {
    supplier: text(fields.supplier),
    barcode: text(fields.barcode),
    unit: text(fields.unit, 50) ?? "kg",
    category: text(fields.category),
    kind,
    storageTemp: text(fields.storageTemp, 100),
    storageConditions: text(fields.storageConditions, 500),
    shelfLifeDays: intOrNull(fields.shelfLifeDays),
    shelfLifeHours: intOrNull(fields.shelfLifeHours),
    servingTemp: kind === "finished" && isServingTemp(fields.servingTemp) ? fields.servingTemp : null,
  };
}

/**
 * Продукт с таким названием (без регистра) уже есть. При переименовании —
 * среди активных, как в `POST /api/products`; при создании (`anyState`) — и
 * среди выключенных: продукт, который организация убрала из справочника,
 * обмен обратно не заводит.
 */
async function productNameTaken(
  organizationId: string,
  name: string,
  options: { exceptId?: string; anyState?: boolean } = {},
): Promise<boolean> {
  const existing = await db.product.findFirst({
    where: {
      organizationId,
      name: { equals: name.trim(), mode: "insensitive" },
      ...(options.anyState ? {} : { isActive: true }),
      ...(options.exceptId ? { id: { not: options.exceptId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(existing);
}

/**
 * Человек с таким ФИО уже есть в организации — в любом виде: с входом,
 * руководитель, в архиве. Обмен видит только сотрудников без входа, и без
 * этой проверки завёл бы второго «Иванова» рядом с настоящим.
 */
async function personNameTaken(organizationId: string, name: string): Promise<boolean> {
  const existing = await db.user.findFirst({
    where: { organizationId, isRoot: false, name: { equals: name.trim(), mode: "insensitive" } },
    select: { id: true },
  });
  return Boolean(existing);
}

function equipmentData(fields: ExchangeFields) {
  return {
    type: text(fields.type, 50) ?? "other",
    serialNumber: text(fields.serialNumber, 100),
    tempMin: numberOrNull(fields.tempMin),
    tempMax: numberOrNull(fields.tempMax),
    lampModel: text(fields.lampModel, 120),
    lampLifetimeHours: intOrNull(fields.lampLifetimeHours),
  };
}

function roomKind(value: unknown): RoomKind {
  return (ROOM_KINDS as readonly string[]).includes(value as string) ? (value as RoomKind) : "other";
}

/**
 * Создать у организации запись по образцу. `parentId` — родитель уже в этой
 * организации (для цеха null — «единственный объект или без объекта»).
 *
 * `mirrorRoom: false` — новый цех не заводит помещение-зеркало. Так идёт
 * обмен, когда организация обменивается и объектами: помещения приходят
 * своим обменом, а зеркало вернулось бы соседям лишним помещением в журнале
 * уборки, которого они не заводили.
 */
export async function createEntityRow(
  entity: ExchangeEntity,
  organizationId: string,
  source: EntityRow,
  parentId: string | null,
  options: { mirrorRoom?: boolean } = {},
): Promise<CreateOutcome> {
  const name = text(source.fields.name, 200);
  if (!name) return { status: "conflict" };
  try {
    switch (entity) {
      case "position": {
        const last = await db.jobPosition.findFirst({
          where: { organizationId },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        });
        const created = await db.jobPosition.create({
          data: { organizationId, categoryKey: STAFF_CATEGORY, name: name.slice(0, 120), sortOrder: (last?.sortOrder ?? 0) + 1 },
          select: { id: true },
        });
        return { status: "created", id: created.id };
      }
      case "staff": {
        // Только на должность категории staff: руководителей обмен не заводит.
        const position = parentId
          ? await db.jobPosition.findFirst({
              where: { id: parentId, organizationId, categoryKey: STAFF_CATEGORY },
              select: { id: true },
            })
          : null;
        if (!position) return { status: "conflict" };
        if (await personNameTaken(organizationId, name)) return { status: "conflict" };
        const input = {
          jobPositionId: position.id,
          fullName: name,
          phone: text(source.fields.phone, 40) ?? undefined,
          weeklyDaysOff: normalizeWeeklyDaysOff(source.fields.weeklyDaysOff),
        };
        let result = await createStaffMember(organizationId, input);
        // Телефон в старом формате не должен оставлять человека без записи.
        if (!result.ok && result.status === 400 && input.phone) {
          result = await createStaffMember(organizationId, { ...input, phone: undefined });
        }
        if (result.ok) return { status: "created", id: result.user.id };
        return result.status === 402 ? { status: "limit" } : { status: "conflict" };
      }
      case "building": {
        const exists = await db.building.findFirst({ where: { organizationId, name }, select: { id: true } });
        if (exists) return { status: "conflict" };
        // Точки тарифа — как в POST /api/settings/buildings: первый объект
        // места не добавляет, каждый следующий — ещё одна точка.
        const buildingsNow = await db.building.count({ where: { organizationId, kind: { not: OFFICE_BUILDING_KIND } } });
        const points = await checkPointsForCreation(organizationId, buildingsNow > 0 ? 1 : 0, { source: EXCHANGE_SOURCE });
        if (!points.ok) return { status: "limit" };
        const created = await db.building.create({
          data: { organizationId, name: name.slice(0, 120), address: text(source.fields.address, 200), sortOrder: 0 },
          select: { id: true },
        });
        return { status: "created", id: created.id };
      }
      case "room": {
        const building = parentId
          ? await db.building.findFirst({
              where: { id: parentId, organizationId, kind: { not: OFFICE_BUILDING_KIND } },
              select: { id: true },
            })
          : null;
        if (!building) return { status: "conflict" };
        const roomName = name.slice(0, 120);
        const exists = await db.room.findFirst({ where: { buildingId: building.id, name: roomName }, select: { id: true } });
        if (exists) return { status: "conflict" };
        const created = await db.room.create({
          data: {
            buildingId: building.id,
            name: roomName,
            kind: roomKind(source.fields.kind),
            sortOrder: intOrNull(source.fields.sortOrder) ?? 0,
          },
          select: { id: true },
        });
        // Цех-зеркало — как в POST /api/settings/rooms (best-effort).
        await ensureRoomMirrorArea({
          organizationId,
          room: { id: created.id, name: roomName, buildingId: building.id },
        }).catch(() => undefined);
        return { status: "created", id: created.id };
      }
      case "area": {
        // Объект образца у организации есть — цех его; иначе единственный
        // объект организации; иначе цех без объекта.
        const findObject = (id: string | null) =>
          id
            ? db.building.findFirst({
                where: { id, organizationId, kind: { not: OFFICE_BUILDING_KIND } },
                select: { id: true },
              })
            : null;
        const building = (await findObject(parentId)) ?? (await findObject(await soleObjectId(organizationId)));
        const created = await db.area.create({
          data: {
            name,
            description: text(source.fields.description, 1000),
            organizationId,
            buildingId: building?.id ?? null,
          },
          select: { id: true, name: true },
        });
        // Помещение-зеркало — как в POST /api/areas (best-effort).
        if (building && options.mirrorRoom !== false) {
          try {
            const sameRoom = await db.room.findFirst({
              where: { buildingId: building.id, name: { equals: created.name, mode: "insensitive" } },
              select: { id: true },
            });
            if (!sameRoom) {
              await db.room.create({
                data: { buildingId: building.id, name: created.name.slice(0, 120), kind: guessRoomKind(created.name) },
              });
            }
          } catch (error) {
            console.error("[directory-exchange] area → room mirror failed", error);
          }
        }
        return { status: "created", id: created.id };
      }
      case "equipment": {
        const area = parentId
          ? await db.area.findFirst({ where: { id: parentId, organizationId }, select: { id: true } })
          : null;
        if (!area) return { status: "conflict" };
        // Датчик (`tuyaDeviceId`) и «кто заполняет» остаются у своей организации.
        const data = equipmentData(source.fields);
        const created = await db.equipment.create({ data: { ...data, name, areaId: area.id }, select: { id: true } });
        if (isFryerEquipmentType(data.type)) await syncFryerOilDocumentsSafe(organizationId);
        return { status: "created", id: created.id };
      }
      case "product": {
        if (await productNameTaken(organizationId, name, { anyState: true })) return { status: "conflict" };
        const created = await db.product.create({
          data: { ...productData(source.fields), name, organizationId },
          select: { id: true },
        });
        return { status: "created", id: created.id };
      }
    }
  } catch (error) {
    if (isUniqueConflict(error)) return { status: "conflict" };
    throw error;
  }
}

/* ───────────────────────── обновление ───────────────────────── */

/**
 * Норма температуры — в активные журналы холодильников организации, как
 * при правке карточки оборудования (`PUT /api/equipment/[id]`). Best-effort.
 */
async function syncColdEquipmentNorms(organizationId: string, equipmentId: string, min: number | null, max: number | null) {
  try {
    const documents = await db.journalDocument.findMany({
      where: { organizationId, status: "active", template: { code: COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE } },
      select: { id: true, config: true },
    });
    for (const document of documents) {
      const { config, changed } = applyEquipmentNormToColdConfig(normalizeColdEquipmentDocumentConfig(document.config), {
        sourceEquipmentId: equipmentId,
        min,
        max,
      });
      if (changed) await db.journalDocument.update({ where: { id: document.id }, data: { config } });
    }
  } catch (error) {
    console.error("[directory-exchange] cold norm sync failed", error);
  }
}

/**
 * Привести запись организации к образцу — только переносимые поля.
 * `parentId`: строка — новый родитель (должность, объект цеха, цех
 * оборудования), `undefined` — родителя не менять.
 */
export async function updateEntityRow(
  entity: ExchangeEntity,
  organizationId: string,
  entityId: string,
  source: EntityRow,
  parentId?: string,
): Promise<UpdateOutcome> {
  const name = text(source.fields.name, 200);
  if (!name) return { status: "conflict" };
  try {
    switch (entity) {
      case "position": {
        const updated = await db.jobPosition.updateMany({
          where: { id: entityId, organizationId, categoryKey: STAFF_CATEGORY },
          data: { name: name.slice(0, 120) },
        });
        return updated.count > 0 ? { status: "updated" } : { status: "missing" };
      }
      case "staff": {
        const current = await db.user.findFirst({
          where: { id: entityId, organizationId, ...ORG_ROSTER_WHERE, passwordHash: "" },
          select: { id: true, role: true, phone: true, positionTitle: true, jobPosition: { select: { name: true } } },
        });
        // Человеку дали вход или сделали руководителем — обмен его больше не правит.
        if (!current || isManagementRole(current.role)) return { status: "missing" };
        const position = parentId
          ? await db.jobPosition.findFirst({
              where: { id: parentId, organizationId, categoryKey: STAFF_CATEGORY },
              select: { id: true, name: true },
            })
          : null;
        const phone = text(source.fields.phone, 40);
        // Должность в подписи меняем, только если она повторяла прежнюю должность.
        const followsPosition = !current.positionTitle || current.positionTitle === current.jobPosition?.name;
        await db.user.update({
          where: { id: current.id },
          data: {
            name,
            // Пустой телефон образца — «сведений нет», а не «сотрите номер».
            ...(phone ? { phone } : {}),
            weeklyDaysOff: normalizeWeeklyDaysOff(source.fields.weeklyDaysOff),
            ...(position
              ? { jobPositionId: position.id, ...(followsPosition ? { positionTitle: position.name } : {}) }
              : {}),
          },
        });
        if (phone && phone !== current.phone) {
          tryAutolinkTasksflowByPhone({ organizationId, weSetupUserId: current.id, phone, name }).catch((error) => {
            console.error("[directory-exchange] tasksflow autolink failed", error);
          });
        }
        return { status: "updated" };
      }
      case "building": {
        const buildingName = name.slice(0, 120);
        const clash = await db.building.findFirst({
          where: { organizationId, name: buildingName, id: { not: entityId } },
          select: { id: true },
        });
        if (clash) return { status: "conflict" };
        const updated = await db.building.updateMany({
          where: { id: entityId, organizationId, kind: { not: OFFICE_BUILDING_KIND } },
          data: { name: buildingName, address: text(source.fields.address, 200) },
        });
        return updated.count > 0 ? { status: "updated" } : { status: "missing" };
      }
      case "room": {
        const current = await db.room.findFirst({
          where: { id: entityId, building: { organizationId, kind: { not: OFFICE_BUILDING_KIND } } },
          select: { id: true, name: true, buildingId: true },
        });
        if (!current) return { status: "missing" };
        const roomName = name.slice(0, 120);
        const clash = await db.room.findFirst({
          where: { buildingId: current.buildingId, name: roomName, id: { not: current.id } },
          select: { id: true },
        });
        if (clash) return { status: "conflict" };
        await db.room.update({
          where: { id: current.id },
          data: { name: roomName, kind: roomKind(source.fields.kind), sortOrder: intOrNull(source.fields.sortOrder) ?? 0 },
        });
        // Цех-зеркало переименовывается вместе с помещением — как в PATCH помещения.
        if (roomName !== current.name) {
          await renameRoomMirrorArea({
            organizationId,
            buildingId: current.buildingId,
            previousName: current.name,
            nextName: roomName,
          }).catch(() => undefined);
        }
        return { status: "updated" };
      }
      case "area": {
        const current = await db.area.findFirst({
          where: { id: entityId, organizationId },
          select: { id: true, description: true },
        });
        if (!current) return { status: "missing" };
        const description = text(source.fields.description, 1000);
        // Объект цеха обмен не меняет: цех остаётся там, где его завела организация.
        await db.area.update({
          where: { id: current.id },
          data: {
            name,
            // Служебное описание цеха-зеркала остаётся, пока образец не задал своё.
            ...(exchangedAreaDescription(current.description) !== description ? { description } : {}),
          },
        });
        return { status: "updated" };
      }
      case "equipment": {
        const current = await db.equipment.findFirst({
          where: { id: entityId, area: { organizationId } },
          select: { id: true, type: true, areaId: true, tempMin: true, tempMax: true },
        });
        if (!current) return { status: "missing" };
        const area = parentId
          ? await db.area.findFirst({ where: { id: parentId, organizationId }, select: { id: true } })
          : null;
        const data = equipmentData(source.fields);
        await db.equipment.update({
          where: { id: current.id },
          data: { ...data, name, ...(area ? { areaId: area.id } : {}) },
        });
        // Те же следствия, что у правки карточки: норма — в журналы
        // холодильников, фритюрница — в журнал фритюра, лампа — в журнал УФ.
        if ((current.tempMin !== data.tempMin || current.tempMax !== data.tempMax) && !isUvLampEquipment({ type: data.type, name })) {
          await syncColdEquipmentNorms(organizationId, current.id, data.tempMin, data.tempMax);
        }
        if (isFryerEquipmentType(current.type) || isFryerEquipmentType(data.type)) {
          await syncFryerOilDocumentsSafe(organizationId);
        }
        if (area && area.id !== current.areaId) {
          await syncUvDocumentPoints(organizationId).catch((error) => console.warn("[directory-exchange] uv points", error));
        }
        return { status: "updated" };
      }
      case "product": {
        if (await productNameTaken(organizationId, name, { exceptId: entityId })) return { status: "conflict" };
        const updated = await db.product.updateMany({
          where: { id: entityId, organizationId, isActive: true },
          data: { ...productData(source.fields), name },
        });
        return updated.count > 0 ? { status: "updated" } : { status: "missing" };
      }
    }
  } catch (error) {
    if (isUniqueConflict(error)) return { status: "conflict" };
    throw error;
  }
}

import { db } from "@/lib/db";
import { ensureServiceCode } from "@/lib/dish-pool";
import { MasterCorrectionError } from "@/lib/master-brakerage-correction";
import { listPoolOrganizations, poolObjectName } from "@/lib/master-directory";
import { journalPointsOf, wholeOrgPoints } from "@/lib/master-pool-points";

/**
 * Подключение и отключение объектов мастер-кабинета — общая часть
 * вкладки «Подключённые объекты» самого кабинета (`/api/master/objects`, по
 * коду журнала) и страницы организации «Мастер-кабинет»
 * (`/api/settings/master-cabinet/objects`, кнопками «Добавить точку» /
 * «Отключить», скан 99 от 2026-10-28).
 *
 * С 2026-10-28 у каждой точки организации с журналами по точкам свой код
 * журнала (`Building.serviceCode`): по нему подключается одна точка
 * (`Building.linkedServiceCode`), а не вся организация. Код организации
 * подключает её целиком, только если своих точек у неё нет или одна.
 * Ошибки для человека — `MasterCorrectionError`.
 */

const POINTS_SELECT = { select: { id: true, name: true, kind: true, linkedServiceCode: true } } as const;
const POOL_OBJECTS_MAX = 100;
export const POOL_CODE_NOT_FOUND = "Журнал с таким кодом не найден. Проверьте код в настройках журнала бракеража на точке.";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
export type PoolActor = { userId: string; userName: string };
export type PoolConnectPreview = { organizationId: string; organizationName: string; connected: boolean };

async function lockPool(tx: Tx, masterOrgId: string): Promise<string> {
  const master = await tx.organization.findUniqueOrThrow({ where: { id: masterOrgId }, select: { linkedServiceCode: true, serviceCode: true } });
  const poolCode = master.linkedServiceCode ?? master.serviceCode!;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`master-pool:${poolCode}`})::bigint)`;
  return poolCode;
}

function audit(tx: Tx, params: PoolActor & { masterOrgId: string; organizationId: string; action: string; entity: string; entityId: string; name: string }) {
  return tx.auditLog.createMany({
    data: [params.masterOrgId, params.organizationId].map((organizationId) => ({
      organizationId,
      userId: params.userId,
      userName: params.userName,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      details: { masterOrgId: params.masterOrgId, organizationName: params.name },
    })),
  });
}

/**
 * Найти журнал по коду (`confirm: false` — только показать, что подключится)
 * или подключить его к кабинету. `code` — уже нормализованный код.
 */
export async function connectPoolObjectByCode(input: {
  masterOrgId: string;
  code: string;
  confirm: boolean;
  actor: PoolActor;
}): Promise<PoolConnectPreview> {
  const { masterOrgId, code, confirm, actor } = input;
  await ensureServiceCode(masterOrgId);
  const poolSize = (await listPoolOrganizations(masterOrgId)).length;
  return db.$transaction(async (tx) => {
    const poolCode = await lockPool(tx, masterOrgId);

    // 1. Код журнала точки — подключается одна точка.
    const point = await tx.building.findUnique({
      where: { serviceCode: code },
      select: { id: true, name: true, kind: true, organization: { select: { id: true, name: true, kind: true, perLocationJournals: true, serviceCode: true, linkedServiceCode: true } } },
    });
    if (point) {
      const org = point.organization;
      if (org.kind === "directory" || org.id === masterOrgId) throw new MasterCorrectionError(POOL_CODE_NOT_FOUND);
      if (journalPointsOf(org, [point]).length === 0) throw new MasterCorrectionError("Эта точка не ведёт свои журналы. Подключите организацию кодом журнала из её настроек.");
      await tx.$queryRaw`SELECT id FROM "Building" WHERE id = ${point.id} FOR UPDATE`;
      const current = await tx.building.findUniqueOrThrow({ where: { id: point.id }, select: { linkedServiceCode: true } });
      if (current.linkedServiceCode && current.linkedServiceCode !== poolCode) throw new MasterCorrectionError("Эта точка уже подключена к другому мастер-кабинету. Подключение не изменено.");
      const orgCode = org.linkedServiceCode ?? org.serviceCode;
      // Организация целиком в другом кабинете — точка там же: сначала отключить её там.
      if (!current.linkedServiceCode && orgCode && orgCode !== poolCode && await tx.organization.count({ where: { kind: "directory", OR: [{ linkedServiceCode: orgCode }, { serviceCode: orgCode, linkedServiceCode: null }] } })) {
        throw new MasterCorrectionError("Эта точка уже подключена к другому мастер-кабинету вместе со своей организацией. Сначала отключите её там.");
      }
      const connected = current.linkedServiceCode === poolCode || orgCode === poolCode;
      if (!connected && poolSize >= POOL_OBJECTS_MAX) throw new MasterCorrectionError(`В одном мастер-кабинете — не больше ${POOL_OBJECTS_MAX} точек и организаций.`);
      const name = poolObjectName(org.name, point.name);
      if (confirm && !connected) {
        await tx.building.update({ where: { id: point.id }, data: { linkedServiceCode: poolCode } });
        await audit(tx, { masterOrgId, organizationId: org.id, ...actor, action: "master_directory.point_connected", entity: "Building", entityId: point.id, name });
      }
      return { organizationId: org.id, organizationName: name, connected: connected || confirm };
    }

    // 2. Код организации — целиком, если своих точек у неё нет или одна.
    const target = await tx.organization.findUnique({ where: { serviceCode: code }, select: { id: true, name: true, kind: true, linkedServiceCode: true, perLocationJournals: true, buildings: POINTS_SELECT } });
    if (!target || target.kind === "directory" || target.id === masterOrgId) throw new MasterCorrectionError(POOL_CODE_NOT_FOUND);
    const points = journalPointsOf(target, target.buildings);
    if (points.length > 1 && (target.linkedServiceCode ?? code) !== poolCode) {
      throw new MasterCorrectionError(`У «${target.name}» несколько точек (${points.length}), у каждой свой журнал. Введите код журнала нужной точки — он в настройках журнала бракеража готовой продукции на этой точке.`);
    }
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${target.id} FOR UPDATE`;
    const current = await tx.organization.findUniqueOrThrow({ where: { id: target.id }, select: { linkedServiceCode: true } });
    if (current.linkedServiceCode && current.linkedServiceCode !== poolCode) throw new MasterCorrectionError("Объект уже подключён к другому мастер-кабинету. Подключение не изменено.");
    if (code !== poolCode && await tx.organization.count({ where: { linkedServiceCode: code, id: { not: target.id } } })) throw new MasterCorrectionError("У объекта уже есть свой общий справочник с подключёнными организациями. Автоматическое объединение недоступно.");
    const connected = current.linkedServiceCode === poolCode || code === poolCode;
    const count = await tx.organization.count({ where: { OR: [{ linkedServiceCode: poolCode }, { serviceCode: poolCode, linkedServiceCode: null }] } });
    if (!connected && count >= 50) throw new MasterCorrectionError("Достигнут лимит 50 организаций в общем справочнике.");
    if (confirm && !connected) {
      await tx.organization.update({ where: { id: target.id }, data: { linkedServiceCode: poolCode } });
      await audit(tx, { masterOrgId, organizationId: target.id, ...actor, action: "master_directory.object_connected", entity: "Organization", entityId: target.id, name: target.name });
    }
    const name = points.length === 1 ? poolObjectName(target.name, points[0].name) : target.name;
    return { organizationId: target.id, organizationName: name, connected: connected || confirm };
  });
}

/**
 * Отключить объект. Точка организации, подключённой целиком: организация
 * выходит из кабинета, а остальные её точки остаются — каждая своей
 * привязкой. Строки и журналы точки не меняются. `null` — объекта в
 * кабинете уже нет.
 */
export async function disconnectPoolObject(input: {
  masterOrgId: string;
  objectId: string;
  actor: PoolActor;
}): Promise<{ name: string } | null> {
  const { masterOrgId, actor } = input;
  const object = (await listPoolOrganizations(masterOrgId)).find((item) => item.id === input.objectId);
  if (!object) return null;
  const ownerError = "Мастер-кабинет создан из этой организации — её нельзя отключить отсюда.";
  await db.$transaction(async (tx) => {
    const poolCode = await lockPool(tx, masterOrgId);
    const org = await tx.organization.findUniqueOrThrow({ where: { id: object.organizationId }, select: { id: true, perLocationJournals: true, serviceCode: true, linkedServiceCode: true, buildings: POINTS_SELECT } });
    const whole = (org.linkedServiceCode ?? org.serviceCode) === poolCode;
    if (object.buildingId) {
      const point = org.buildings.find((building) => building.id === object.buildingId);
      if (!point) throw new MasterCorrectionError("Точка не найдена");
      if (whole) {
        // Организация была в кабинете целиком: остальные её точки остаются своими привязками.
        if (org.linkedServiceCode !== poolCode) throw new MasterCorrectionError(ownerError);
        const others = wholeOrgPoints(org, org.buildings, poolCode).filter((building) => building.id !== point.id);
        if (others.length > 0) {
          await tx.building.updateMany({ where: { id: { in: others.map((building) => building.id) } }, data: { linkedServiceCode: poolCode } });
        }
        await tx.organization.update({ where: { id: org.id }, data: { linkedServiceCode: null } });
      }
      if (point.linkedServiceCode === poolCode) {
        await tx.building.update({ where: { id: point.id }, data: { linkedServiceCode: null } });
      }
      await audit(tx, { masterOrgId, organizationId: org.id, ...actor, action: "master_directory.point_disconnected", entity: "Building", entityId: point.id, name: object.name });
      return;
    }
    if (org.linkedServiceCode !== poolCode) throw new MasterCorrectionError(ownerError);
    await tx.organization.update({ where: { id: org.id }, data: { linkedServiceCode: null } });
    await audit(tx, { masterOrgId, organizationId: org.id, ...actor, action: "master_directory.object_disconnected", entity: "Organization", entityId: org.id, name: object.name });
  });
  return { name: object.name };
}

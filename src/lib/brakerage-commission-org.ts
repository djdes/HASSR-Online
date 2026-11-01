import type { Prisma } from "@prisma/client";

import {
  COMMISSION_FLAG_JOURNAL_CODES,
  COMMISSION_JOURNAL_CODES,
  effectiveCommissionMembers,
  isCommissionJournalCode,
  normalizeCommissionMembers,
  normalizeCommissionRole,
  type CommissionRoleKind,
  type BrakerageCommissionMember,
} from "@/lib/brakerage-commission";
import { staffAtBuildingWhere } from "@/lib/building-settings";
import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import { COMMISSION_CATEGORY_KEY, ORG_SIGNER_WHERE } from "@/lib/journal-roster";

/**
 * Состав бракеражной комиссии на уровне организации (по коду журнала):
 * `Organization.journalCommissionJson[code]`. Источник — окно «Сторонняя
 * бракеражная комиссия»; при сохранении состав копируется в
 * `config.commissionMembers` активных документов, а новый документ получает
 * его при создании. Модель «копия»: закрытые документы и их печать не
 * меняются, когда состав потом сменят.
 *
 * Каждая серверная копия состава ставит в конфиг метку
 * `commissionEnabled: true`: у скоропорта состав действует только с ней
 * (старые копии до решения 2026-09-22 не оживают — см.
 * `effectiveCommissionMembers`).
 */

export const COMMISSION_POSITION_NAME = "Член бракеражной комиссии";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Где хранится состав: у точки со своим составом (слитая организация,
 * `Building.journalCommissionJson` задан) — в точке, иначе в организации.
 */
async function commissionOwner(
  organizationId: string,
  buildingId: string | null | undefined
): Promise<{ buildingId: string | null; json: unknown }> {
  if (buildingId) {
    const building = await db.building.findFirst({
      where: { id: buildingId, organizationId },
      select: { journalCommissionJson: true },
    });
    if (building && building.journalCommissionJson !== null) {
      return { buildingId, json: building.journalCommissionJson };
    }
  }
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { journalCommissionJson: true },
  });
  return { buildingId: null, json: org?.journalCommissionJson ?? null };
}

/** Состав комиссии журнала; с точкой — состав точки, если он у неё свой. */
export async function readOrgCommission(
  organizationId: string,
  code: string,
  buildingId?: string | null
): Promise<BrakerageCommissionMember[]> {
  const owner = await commissionOwner(organizationId, buildingId);
  return normalizeCommissionMembers(asRecord(owner.json)[code]);
}

/**
 * Куда пишется состав (2026-11-01): точка из шапки получает свой состав —
 * если его ещё не было, ей копируется состав организации по всем журналам,
 * и дальше она живёт им; без точки — организация. Раньше правка точки без
 * своего состава уходила в организацию и меняла комиссию всех точек.
 */
async function commissionWriteOwner(
  organizationId: string,
  pointId: string | null | undefined
): Promise<{ buildingId: string | null; json: unknown }> {
  if (!pointId) return commissionOwner(organizationId, null);
  const building = await db.building.findFirst({
    where: { id: pointId, organizationId },
    select: { journalCommissionJson: true },
  });
  if (!building) throw new Error(`Точка ${pointId} не найдена`);
  if (building.journalCommissionJson !== null) return { buildingId: pointId, json: building.journalCommissionJson };
  const org = await commissionOwner(organizationId, null);
  return { buildingId: pointId, json: org.json };
}

/**
 * Сохранить состав: имена и id берутся из базы (только сотрудники этой
 * организации, включая стороннюю комиссию; у точки — работающие на ней),
 * роль — из запроса. Возвращает состав и число обновлённых активных
 * документов. `pointId` — точка из шапки: состав пишется ей
 * (`commissionWriteOwner`) и копируется только в её документы; без точки —
 * состав организации, он не трогает документы точек со своим составом.
 */
export async function saveOrgCommission(
  organizationId: string,
  code: string,
  input: Array<{ employeeId: string; role?: string; roleKind?: CommissionRoleKind }>,
  pointId?: string | null
): Promise<{ members: BrakerageCommissionMember[]; updatedDocuments: number }> {
  if (!isCommissionJournalCode(code)) throw new Error("Журнал без комиссии");
  const ids = [...new Set(input.map((item) => item.employeeId).filter(Boolean))];
  const users = await db.user.findMany({
    where: { id: { in: ids }, organizationId, ...ORG_SIGNER_WHERE, ...staffAtBuildingWhere(pointId) },
    select: { id: true, name: true },
  });
  const byId = new Map(users.map((user) => [user.id, user]));
  const members = normalizeCommissionMembers(
    input
      .filter((item) => byId.has(item.employeeId))
      .map((item, index) => ({
        id: `commission-${item.employeeId}`,
        ...normalizeCommissionRole(item.role, item.roleKind, index === 0 ? "chair" : "member"),
        employeeId: item.employeeId,
        employeeName: byId.get(item.employeeId)?.name ?? "",
      }))
  );

  const owner = await commissionWriteOwner(organizationId, pointId);
  const nextJson = { ...asRecord(owner.json), [code]: members } as Prisma.InputJsonValue;
  if (owner.buildingId) {
    await db.building.update({ where: { id: owner.buildingId }, data: { journalCommissionJson: nextJson } });
  } else {
    await db.organization.update({ where: { id: organizationId }, data: { journalCommissionJson: nextJson } });
  }

  // Точки со своим составом живут отдельно: состав организации их не трогает.
  const ownBuildingIds = owner.buildingId
    ? []
    : (
        await db.building.findMany({
          where: { organizationId },
          select: { id: true, journalCommissionJson: true },
        })
      )
        .filter((building) => building.journalCommissionJson !== null)
        .map((building) => building.id);
  const docs = await db.journalDocument.findMany({
    where: {
      organizationId,
      status: "active",
      template: { code },
      ...(owner.buildingId
        ? { buildingId: owner.buildingId }
        : ownBuildingIds.length > 0
          ? { OR: [{ buildingId: null }, { buildingId: { notIn: ownBuildingIds } }] }
          : {}),
    },
    select: { id: true },
  });
  let updatedDocuments = 0;
  for (const doc of docs) {
    const done = await withDocumentConfigLock(doc.id, async (locked) => ({
      config: { ...asRecord(locked.config), commissionMembers: members, commissionEnabled: true } as Prisma.InputJsonValue,
      result: true,
    }));
    if (done) updatedDocuments += 1;
  }
  return { members, updatedDocuments };
}

/** Состав для нового документа: берётся из точки или организации, если в конфиге его нет. */
export async function withOrgCommission(
  organizationId: string,
  code: string,
  config: Record<string, unknown>,
  buildingId?: string | null
): Promise<Record<string, unknown>> {
  if (!isCommissionJournalCode(code)) return config;
  // Свой действующий состав (перенос из прошлого документа) не трогаем.
  // Старая копия скоропорта без метки — не действующая: её заменяет
  // утверждённый состав организации.
  if (effectiveCommissionMembers(code, config).length > 0) return config;
  const members = await readOrgCommission(organizationId, code, buildingId);
  return members.length > 0 ? { ...config, commissionMembers: members, commissionEnabled: true } : config;
}

/**
 * Должность «Член бракеражной комиссии» категории «Комиссия» с доступом к
 * бракеражным журналам с комиссией (готовая продукция и скоропорт) —
 * находит или создаёт. Новые люди из окна комиссии
 * попадают в неё и видят на странице сотрудников колонку «Комиссия».
 */
export async function ensureCommissionPosition(organizationId: string): Promise<{ id: string }> {
  const existing = await db.jobPosition.findFirst({
    where: { organizationId, categoryKey: COMMISSION_CATEGORY_KEY, name: COMMISSION_POSITION_NAME },
    select: { id: true },
  });
  const position =
    existing ??
    (await db.jobPosition.create({
      data: { organizationId, categoryKey: COMMISSION_CATEGORY_KEY, name: COMMISSION_POSITION_NAME, sortOrder: 0 },
      select: { id: true },
    }));
  const templates = await db.journalTemplate.findMany({
    where: { code: { in: [...COMMISSION_JOURNAL_CODES] } },
    select: { id: true },
  });
  for (const template of templates) {
    await db.jobPositionJournalAccess
      .create({ data: { organizationId, jobPositionId: position.id, templateId: template.id } })
      .catch(() => null);
  }
  return position;
}

/**
 * «Новый человек» из окна комиссии — сразу в утверждённом составе: к
 * текущему составу организации добавляется он, дальше как при сохранении
 * (копия в активные документы). Уже в составе — состав не меняется.
 */
export async function addOrgCommissionMember(
  organizationId: string,
  code: string,
  member: { employeeId: string; role?: string; roleKind?: CommissionRoleKind },
  pointId?: string | null
): Promise<{ members: BrakerageCommissionMember[]; updatedDocuments: number }> {
  const current = await readOrgCommission(organizationId, code, pointId);
  if (current.some((item) => item.employeeId === member.employeeId)) {
    return { members: current, updatedDocuments: 0 };
  }
  return saveOrgCommission(
    organizationId,
    code,
    [
      ...current.map((item) => ({ employeeId: item.employeeId, role: item.role, roleKind: item.roleKind })),
      { employeeId: member.employeeId, ...normalizeCommissionRole(member.role, member.roleKind) },
    ],
    pointId
  );
}

/**
 * Член состава организации, которого нет в копии документа (копию меняли
 * до того, как его добавили): дописываем в копию только его — чужие правки
 * состава документа не затираем. Под блокировкой документа, как
 * `saveOrgCommission`; иначе подпись `signBrakerageRows` вернёт 403.
 */
export async function syncDocCommissionMember(documentId: string, member: BrakerageCommissionMember): Promise<boolean> {
  const done = await withDocumentConfigLock<boolean>(documentId, async (locked) => {
    if (locked.status !== "active" || !isCommissionJournalCode(locked.templateCode)) return { result: false };
    const config = asRecord(locked.config);
    // Только действующий состав: старая копия скоропорта без метки не
    // оживает — вместо неё в документ встаёт утверждённый состав организации.
    const inactiveCopy = COMMISSION_FLAG_JOURNAL_CODES.has(locked.templateCode) && config.commissionEnabled !== true;
    const members = inactiveCopy
      ? await readOrgCommission(locked.organizationId, locked.templateCode, locked.buildingId)
      : effectiveCommissionMembers(locked.templateCode, config);
    if (!inactiveCopy && members.some((item) => item.employeeId === member.employeeId)) return { result: true };
    const next = normalizeCommissionMembers([...members, member]);
    if (!next.some((item) => item.employeeId === member.employeeId)) return { result: false };
    return { config: { ...config, commissionMembers: next, commissionEnabled: true } as Prisma.InputJsonValue, result: true };
  });
  return done === true;
}

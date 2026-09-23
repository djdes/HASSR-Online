import type { Prisma } from "@prisma/client";

import {
  COMMISSION_JOURNAL_CODES,
  isCommissionJournalCode,
  normalizeCommissionMembers,
  type BrakerageCommissionMember,
} from "@/lib/brakerage-commission";
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
 */

export const COMMISSION_POSITION_NAME = "Член бракеражной комиссии";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function readOrgCommission(organizationId: string, code: string): Promise<BrakerageCommissionMember[]> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { journalCommissionJson: true },
  });
  return normalizeCommissionMembers(asRecord(org?.journalCommissionJson)[code]);
}

/**
 * Сохранить состав: имена и id берутся из базы (только сотрудники этой
 * организации, включая стороннюю комиссию), роль — из запроса. Возвращает
 * состав и число обновлённых активных документов.
 */
export async function saveOrgCommission(
  organizationId: string,
  code: string,
  input: Array<{ employeeId: string; role?: string }>
): Promise<{ members: BrakerageCommissionMember[]; updatedDocuments: number }> {
  if (!isCommissionJournalCode(code)) throw new Error("Журнал без комиссии");
  const ids = [...new Set(input.map((item) => item.employeeId).filter(Boolean))];
  const users = await db.user.findMany({
    where: { id: { in: ids }, organizationId, ...ORG_SIGNER_WHERE },
    select: { id: true, name: true },
  });
  const byId = new Map(users.map((user) => [user.id, user]));
  const members = normalizeCommissionMembers(
    input
      .filter((item) => byId.has(item.employeeId))
      .map((item, index) => ({
        id: `commission-${item.employeeId}`,
        role: item.role || (index === 0 ? "Председатель" : "Член комиссии"),
        employeeId: item.employeeId,
        employeeName: byId.get(item.employeeId)?.name ?? "",
      }))
  );

  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { journalCommissionJson: true } });
  await db.organization.update({
    where: { id: organizationId },
    data: {
      journalCommissionJson: { ...asRecord(org?.journalCommissionJson), [code]: members } as Prisma.InputJsonValue,
    },
  });

  const docs = await db.journalDocument.findMany({
    where: { organizationId, status: "active", template: { code } },
    select: { id: true },
  });
  let updatedDocuments = 0;
  for (const doc of docs) {
    const done = await withDocumentConfigLock(doc.id, async (locked) => ({
      config: { ...asRecord(locked.config), commissionMembers: members } as Prisma.InputJsonValue,
      result: true,
    }));
    if (done) updatedDocuments += 1;
  }
  return { members, updatedDocuments };
}

/** Состав для нового документа: берётся из организации, если в конфиге его нет. */
export async function withOrgCommission(
  organizationId: string,
  code: string,
  config: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // Сторонняя комиссия — только у бракеража готовой продукции.
  if (!isCommissionJournalCode(code)) return config;
  if (Array.isArray(config.commissionMembers) && config.commissionMembers.length > 0) return config;
  const members = await readOrgCommission(organizationId, code);
  return members.length > 0 ? { ...config, commissionMembers: members } : config;
}

/**
 * Должность «Член бракеражной комиссии» категории «Комиссия» с доступом к
 * бракеражу готовой продукции (у скоропорта комиссии нет) — находит или создаёт. Новые люди из окна комиссии
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
  member: { employeeId: string; role?: string }
): Promise<{ members: BrakerageCommissionMember[]; updatedDocuments: number }> {
  const current = await readOrgCommission(organizationId, code);
  if (current.some((item) => item.employeeId === member.employeeId)) {
    return { members: current, updatedDocuments: 0 };
  }
  return saveOrgCommission(organizationId, code, [
    ...current.map((item) => ({ employeeId: item.employeeId, role: item.role })),
    { employeeId: member.employeeId, role: member.role || "Член комиссии" },
  ]);
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
    const members = normalizeCommissionMembers(config.commissionMembers);
    if (members.some((item) => item.employeeId === member.employeeId)) return { result: true };
    const next = normalizeCommissionMembers([...members, member]);
    if (!next.some((item) => item.employeeId === member.employeeId)) return { result: false };
    return { config: { ...config, commissionMembers: next } as Prisma.InputJsonValue, result: true };
  });
  return done === true;
}

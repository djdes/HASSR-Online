/**
 * Кто попадает СТРОКАМИ в per-employee журналы (гигиена, здоровье).
 *
 * До этого модуля выбор жил внутри `seedEntriesForDocument` и повторялся
 * в ручных действиях страницы документа — две реализации расходились.
 * Теперь она одна, а поверх неё работает политика из
 * `journalAutomationJson[code].staff`:
 *
 *   • legacy (ключа нет) — должности из `JobPositionJournalAccess`, а если
 *     под них не подошёл никто — весь активный ростер. Ровно то поведение,
 *     что было до появления политики: существующие организации ничего не
 *     замечают.
 *   • inherit — строки последнего документа шаблона ∪ новые сотрудники,
 *     подходящие по legacy-правилу и нанятые ПОСЛЕ его создания. Журнал
 *     «продолжается»: удалённые вручную из прошлого документа не
 *     воскресают, новички не теряются.
 *   • custom — ровно выбранные ∩ активные; новички сами не добавляются.
 *
 * Пустой результат любой ветки — это легаси-фолбэк: журнал с нулём строк
 * не создаём никогда.
 */
import type { PrismaClient } from "@prisma/client";
import type { JournalAutomationStaff } from "@/lib/journal-automation";
import { filterRoster } from "@/lib/journal-roster";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";

export type AutomationStaffSource = "custom" | "inherit" | "legacy";

export type ResolveAutomationStaffResult = {
  employeeIds: string[];
  source: AutomationStaffSource;
};

type StaffDb = Pick<
  PrismaClient,
  | "user"
  | "journalTemplate"
  | "jobPositionJournalAccess"
  | "journalDocument"
  | "journalDocumentEntry"
>;

/**
 * Пересечение «выбранных» с «живыми» с сохранением порядка выбора.
 * Чистая — проверяется юнит-тестом без похода в БД.
 */
export function keepAliveIds(
  requestedIds: string[],
  aliveIds: Iterable<string>
): string[] {
  const alive = new Set(aliveIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of requestedIds) {
    if (!id || seen.has(id) || !alive.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Наследование: строки прошлого документа плюс новички. Порядок — сперва
 * унаследованные (чтобы таблица выглядела как продолжение прошлой), потом
 * добавленные.
 */
export function mergeInheritedWithNewcomers(
  inheritedIds: string[],
  newcomerIds: string[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...inheritedIds, ...newcomerIds]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Легаси-правило: должности из `JobPositionJournalAccess`, при пустом
 * результате — весь активный ростер (тот же fallback, что и раньше в
 * сидере: доступ выдан по должности, а `jobPositionId` у людей ещё null).
 */
export async function loadLegacyEligibleEmployees(
  db: StaffDb,
  args: { organizationId: string; templateCode: string }
): Promise<string[]> {
  const template = await db.journalTemplate.findUnique({
    where: { code: args.templateCode },
    select: { id: true },
  });
  if (!template) return [];

  const accessRows = await db.jobPositionJournalAccess.findMany({
    where: { templateId: template.id, organizationId: args.organizationId },
    select: { jobPositionId: true },
  });
  const allowedPositionIds = accessRows.map((row) => row.jobPositionId);

  const employees = await db.user.findMany({
    where: {
      organizationId: args.organizationId,
      isActive: true,
      archivedAt: null,
      isRoot: false,
      ...NOT_COMMISSION_WHERE,
      ...(allowedPositionIds.length > 0
        ? { jobPositionId: { in: allowedPositionIds } }
        : {}),
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  if (employees.length > 0 || allowedPositionIds.length === 0) {
    return filterRoster(employees).map((employee) => employee.id);
  }

  const fallback = await db.user.findMany({
    where: {
      organizationId: args.organizationId,
      isActive: true,
      archivedAt: null,
      isRoot: false,
      ...NOT_COMMISSION_WHERE,
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  // Аккаунт «имя = почта» (мгновенная регистрация) — не человек из штата:
  // строки на него заводим, только если больше некому.
  return filterRoster(fallback).map((employee) => employee.id);
}

async function loadAliveIds(
  db: StaffDb,
  args: { organizationId: string; ids: string[] }
): Promise<Set<string>> {
  if (args.ids.length === 0) return new Set();
  const alive = await db.user.findMany({
    where: {
      id: { in: args.ids },
      organizationId: args.organizationId,
      isActive: true,
      archivedAt: null,
      ...NOT_COMMISSION_WHERE,
    },
    select: { id: true },
  });
  return new Set(alive.map((user) => user.id));
}

async function resolveInherited(
  db: StaffDb,
  args: { organizationId: string; templateCode: string }
): Promise<string[]> {
  const template = await db.journalTemplate.findUnique({
    where: { code: args.templateCode },
    select: { id: true },
  });
  if (!template) return [];

  const lastDocument = await db.journalDocument.findFirst({
    where: { organizationId: args.organizationId, templateId: template.id },
    orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
    select: { id: true, createdAt: true },
  });
  if (!lastDocument) return [];

  // Сид-строки (`_autoSeeded`) включаем намеренно: строки документа и
  // есть его список сотрудников, заполнены они или нет.
  const rows = await db.journalDocumentEntry.findMany({
    where: { documentId: lastDocument.id },
    select: { employeeId: true },
    distinct: ["employeeId"],
  });
  const previousIds = rows.map((row) => row.employeeId);
  const aliveIds = await loadAliveIds(db, {
    organizationId: args.organizationId,
    ids: previousIds,
  });
  const inherited = keepAliveIds(previousIds, aliveIds);

  // Новички: подходят по легаси-правилу и наняты позже прошлого документа.
  const eligible = await loadLegacyEligibleEmployees(db, args);
  const previousSet = new Set(previousIds);
  const candidateIds = eligible.filter((id) => !previousSet.has(id));
  if (candidateIds.length === 0) return inherited;

  const newcomers = await db.user.findMany({
    where: {
      id: { in: candidateIds },
      organizationId: args.organizationId,
      isActive: true,
      archivedAt: null,
      ...NOT_COMMISSION_WHERE,
      createdAt: { gt: lastDocument.createdAt },
    },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  return mergeInheritedWithNewcomers(
    inherited,
    newcomers.map((user) => user.id)
  );
}

export async function resolveAutomationStaff(
  db: StaffDb,
  args: {
    organizationId: string;
    templateCode: string;
    staffPolicy?: JournalAutomationStaff;
  }
): Promise<ResolveAutomationStaffResult> {
  const policy = args.staffPolicy;

  if (policy?.mode === "custom") {
    const aliveIds = await loadAliveIds(db, {
      organizationId: args.organizationId,
      ids: policy.userIds,
    });
    const employeeIds = keepAliveIds(policy.userIds, aliveIds);
    if (employeeIds.length > 0) return { employeeIds, source: "custom" };
  }

  if (policy?.mode === "inherit") {
    const employeeIds = await resolveInherited(db, args);
    if (employeeIds.length > 0) return { employeeIds, source: "inherit" };
  }

  return {
    employeeIds: await loadLegacyEligibleEmployees(db, args),
    source: "legacy",
  };
}

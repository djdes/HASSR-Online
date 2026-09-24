import { db } from "@/lib/db";
import { hasJournalAccess } from "@/lib/journal-acl";
import { supportsOrderScans } from "@/lib/journal-order-scans";
import type { OrderScanForPdf } from "@/lib/journal-order-scans-pdf";
import { hasCapability } from "@/lib/permission-presets";
import { isManagementRole } from "@/lib/user-roles";

/**
 * Сканы приказов к журналу — чтение из БД и права. Файлы лежат в
 * `JournalOrderScan.content` (Bytes) и отдаются только через API с
 * проверкой организации — публичной ссылки на файл нет.
 */

export type OrderScanListItem = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedByName: string | null;
};

export async function listOrderScans(organizationId: string, journalCode: string): Promise<OrderScanListItem[]> {
  if (!supportsOrderScans(journalCode)) return [];
  const rows = await db.journalOrderScan.findMany({
    where: { organizationId, journalCode },
    select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, uploadedByName: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/** Файлы для печати — по дате загрузки. Не тот журнал — пусто. */
export async function loadOrderScansForPdf(organizationId: string, journalCode: string): Promise<OrderScanForPdf[]> {
  if (!supportsOrderScans(journalCode)) return [];
  const rows = await db.journalOrderScan.findMany({
    where: { organizationId, journalCode },
    select: { id: true, title: true, mimeType: true, content: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({ id: row.id, title: row.title, mimeType: row.mimeType, content: new Uint8Array(row.content) }));
}

/**
 * Версия набора приказов для ключей кэша (листы проверяющего): меняется
 * при загрузке, переименовании и удалении.
 */
export async function orderScansVersion(organizationId: string, journalCode: string): Promise<string> {
  if (!supportsOrderScans(journalCode)) return "-";
  const agg = await db.journalOrderScan.aggregate({
    where: { organizationId, journalCode },
    _max: { updatedAt: true },
    _count: { _all: true },
  });
  return `${agg._count._all}:${agg._max.updatedAt?.toISOString() ?? "-"}`;
}

type SessionUser = {
  id: string;
  role: string;
  isRoot?: boolean | null;
  permissionPreset?: string | null;
  orgPresetOverrides?: Record<string, string[]> | null;
};

/** Загрузить, переименовать, удалить — как настройки документа журнала (руководство). */
export function canManageOrderScans(user: SessionUser): boolean {
  if (user.isRoot === true) return true;
  return isManagementRole(user.role) && hasCapability(user, "journals.manage");
}

/** Смотреть — всем, кому доступен журнал. */
export async function canViewOrderScans(user: SessionUser, journalCode: string): Promise<boolean> {
  if (!supportsOrderScans(journalCode)) return false;
  return hasJournalAccess({ id: user.id, role: user.role, isRoot: user.isRoot === true }, journalCode);
}

/** AuditLog загрузки / переименования / удаления приказа. Ошибка аудита не ломает действие. */
export async function writeOrderScanAudit(input: {
  organizationId: string;
  userId: string;
  userName: string | null;
  action: "journal_order_scan.upload" | "journal_order_scan.rename" | "journal_order_scan.delete";
  scanId: string;
  details: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        userName: input.userName,
        action: input.action,
        entity: "JournalOrderScan",
        entityId: input.scanId,
        details: input.details as object,
      },
    });
  } catch (err) {
    console.error("[order-scans] audit failed", input.action, err);
  }
}

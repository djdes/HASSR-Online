import { db } from "./db";

export type AuditAction =
  | "journal_entry.create"
  | "journal_entry.copy"
  | "journal_entry.delete"
  | "attachment.upload"
  | "staff.add"
  | "staff.update"
  | "equipment.add"
  | "equipment.update"
  | "journal_document.approve_all"
  | "journal_document.reject_document"
  | "journal_document.approve_cells"
  | "journal_document.reject_cells"
  /** Меркурий: приёмка с гашением ВСД и приёмка без гашения. */
  | "mercury.process"
  | "mercury.acknowledge"
  /** ЭДО: входящая накладная загружена, принята в журнал, не принята, отложена; подключение. */
  | "supply.document_add"
  | "supply.accept"
  | "supply.ignore"
  | "supply.connect"
  | "supply.disconnect"
  /** Сотрудник задал пароль по ссылке руководителя и вошёл без Telegram. */
  | "employee.paired_device";

export async function logAudit(args: {
  organizationId: string;
  userId?: string;
  userName?: string;
  action: AuditAction;
  entity: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organizationId: args.organizationId,
        userId: args.userId,
        userName: args.userName,
        action: args.action,
        entity: args.entity,
        entityId: args.entityId,
        details: args.details as never,
        ipAddress: args.ipAddress,
      },
    });
  } catch (err) {
    // Audit logging should never break the main flow
    console.error("[audit] failed to log:", err);
  }
}

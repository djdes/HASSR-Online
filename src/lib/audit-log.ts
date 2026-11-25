import { db } from "@/lib/db";
import { clientIp } from "@/lib/client-ip";
import { AD_VISIT_ENTITY } from "@/lib/ad-campaign";

/**
 * Минимальный helper для записи admin-действий в `AuditLog`. Точка
 * вызова — любой POST/PUT/DELETE handler, который мутирует state
 * платформы. Запись best-effort — не блокирует ответ юзера, ошибки
 * логируются и проглатываются.
 *
 * Пример:
 *   await recordAuditLog({
 *     request,
 *     session,
 *     organizationId,
 *     action: "settings.tasksflow.connect",
 *     entity: "TasksFlowIntegration",
 *     entityId: integration.id,
 *     details: { url, label },
 *   });
 */
export interface AuditLogInput {
  request?: Request;
  session?: {
    user?: { id?: string | null; name?: string | null; email?: string | null };
  } | null;
  /** Обязателен — модель AuditLog организационно-скоупна. */
  organizationId: string;
  action: string;
  entity: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
}

export async function recordAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.session?.user?.id ?? null,
        userName:
          input.session?.user?.name ?? input.session?.user?.email ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        details: (input.details ?? {}) as object,
        ipAddress: clientIp(input.request),
      },
    });
  } catch (err) {
    // Аудит не должен ломать основной flow — просто логируем.
    console.error("[audit] write failed", input.action, err);
  }
}

/**
 * Удаление старых записей (старше 365 дней). Вызывается из cron-а
 * `/api/cron/audit-prune` (опционально).
 */
export async function pruneOldAuditLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const result = await db.auditLog.deleteMany({
    // Campaign facts are the denominator of an all-time admin report.
    where: { createdAt: { lt: cutoff }, entity: { not: AD_VISIT_ENTITY } },
  });
  return result.count;
}

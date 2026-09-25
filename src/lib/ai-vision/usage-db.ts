import { Prisma } from "@prisma/client";

import { VISION_QUOTA_WINDOW_MS, type VisionUsage } from "@/lib/ai-vision/quota";
import { db } from "@/lib/db";

/**
 * Учёт распознаваний с фото в журнале действий (AuditLog): одна запись на
 * распознавание. По ним же считаются суточные лимиты — поэтому счётчик
 * переживает перезапуск сервера. Поля выбраны под существующие индексы:
 * организация — `[organizationId, createdAt]`, сотрудник —
 * `[entity, entityId]` (entityId = id сотрудника).
 */

export const VISION_AUDIT_ACTION = "ai.vision_extract";
export const VISION_AUDIT_ENTITY = "ai_vision";

export type VisionUsageResult = "ok" | "empty" | "timeout" | "failed";

export async function countVisionUsage(args: { orgId: string; userId: string; now?: number }): Promise<VisionUsage> {
  const since = new Date((args.now ?? Date.now()) - VISION_QUOTA_WINDOW_MS);
  const [org, user] = await Promise.all([
    db.auditLog.count({
      where: { organizationId: args.orgId, createdAt: { gte: since }, action: VISION_AUDIT_ACTION },
    }),
    db.auditLog.count({
      where: { entity: VISION_AUDIT_ENTITY, entityId: args.userId, createdAt: { gte: since }, action: VISION_AUDIT_ACTION },
    }),
  ]);
  return { org, user };
}

/** Запись «распознавание начато» — считается в лимит сразу, до ответа. */
export async function recordVisionUsage(args: {
  orgId: string;
  userId: string;
  userName?: string | null;
  visionKind: string;
  photos: number;
}): Promise<string | null> {
  try {
    const row = await db.auditLog.create({
      data: {
        organizationId: args.orgId,
        userId: args.userId,
        userName: args.userName ?? null,
        action: VISION_AUDIT_ACTION,
        entity: VISION_AUDIT_ENTITY,
        entityId: args.userId,
        details: { visionKind: args.visionKind, photos: args.photos } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return row.id;
  } catch (error) {
    console.warn("[ai-vision] audit record failed:", error);
    return null;
  }
}

/** Итог распознавания в той же записи: сколько строк, чем кончилось. */
export async function finishVisionUsage(
  id: string | null,
  details: { visionKind: string; photos: number; result: VisionUsageResult; recognized?: number; durationMs: number }
): Promise<void> {
  if (!id) return;
  try {
    await db.auditLog.update({ where: { id }, data: { details: details as Prisma.InputJsonValue } });
  } catch (error) {
    console.warn("[ai-vision] audit update failed:", error);
  }
}

/** Задание не ушло в очередь — модель не работала, в лимит не считаем. */
export async function forgetVisionUsage(id: string | null): Promise<void> {
  if (!id) return;
  try {
    await db.auditLog.delete({ where: { id } });
  } catch (error) {
    console.warn("[ai-vision] audit delete failed:", error);
  }
}

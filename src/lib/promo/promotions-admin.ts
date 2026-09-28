import { z } from "zod";

import { db } from "@/lib/db";

import { PAID_ORDER_STATUSES } from "./service";
import { dateToMskInput, type PromotionAdminRow, type PromotionAuditEntry } from "./promotions";

/**
 * ROOT → «Акции»: список со статистикой оплат и история изменений.
 * Серверный модуль (db); типы строк — в client-safe promotions.ts.
 */

export const PLATFORM_ORG_ID = process.env.PLATFORM_ORG_ID || "platform";
export const PROMOTION_AUDIT_ENTITY = "PricePromotion";

/**
 * Тело запросов ROOT. Время — строкой «2026-10-01T00:00», читается как
 * московское (mskInputToDate): момент решает сервер, а не браузер ROOT.
 * Смысловые проверки (процент, конец позже начала) — validatePromotionInput.
 */
const MSK_INPUT = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Дата и время: ГГГГ-ММ-ДДTЧЧ:ММ");

export const promotionCreateSchema = z.object({
  title: z.string().max(200),
  percent: z.number(),
  startsAt: MSK_INPUT,
  endsAt: MSK_INPUT,
  active: z.boolean().optional(),
  note: z.string().max(1000).nullable().optional(),
});

export const promotionPatchSchema = promotionCreateSchema.partial();

type PromotionRecord = {
  id: string;
  title: string;
  percent: number;
  startsAt: Date;
  endsAt: Date;
  active: boolean;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toPromotionAdminRow(
  row: PromotionRecord,
  stats: { paidOrders: number; discountTotalRub: number } = { paidOrders: 0, discountTotalRub: 0 }
): PromotionAdminRow {
  return {
    id: row.id,
    title: row.title,
    percent: row.percent,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    startsAtMsk: dateToMskInput(row.startsAt),
    endsAtMsk: dateToMskInput(row.endsAt),
    active: row.active,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...stats,
  };
}

/** Все акции, новые сверху, со счётчиком оплат и суммой скидок по каждой. */
export async function listPromotionsForRoot(): Promise<PromotionAdminRow[]> {
  const rows = await db.pricePromotion.findMany({ orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }] });
  if (rows.length === 0) return [];
  const stats = await db.paymentOrder.groupBy({
    by: ["promotionId"],
    where: { promotionId: { in: rows.map((r) => r.id) }, status: { in: [...PAID_ORDER_STATUSES] } },
    _count: { _all: true },
    _sum: { promotionDiscountRub: true },
  });
  const byId = new Map(
    stats.map((s) => [
      s.promotionId ?? "",
      { paidOrders: s._count._all, discountTotalRub: s._sum.promotionDiscountRub ?? 0 },
    ])
  );
  return rows.map((row) => toPromotionAdminRow(row, byId.get(row.id)));
}

/** Последние изменения акций из AuditLog (пишут /api/root/promotions*). */
export async function listPromotionAudit(limit = 20): Promise<PromotionAuditEntry[]> {
  const logs = await db.auditLog.findMany({
    where: { entity: PROMOTION_AUDIT_ENTITY },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, action: true, entityId: true, userName: true, details: true, createdAt: true },
  });
  return logs.map((log) => {
    const details = (log.details ?? {}) as Record<string, unknown>;
    return {
      id: log.id,
      action: log.action,
      promotionId: log.entityId,
      userName: log.userName,
      at: log.createdAt.toISOString(),
      title: typeof details.title === "string" ? details.title : null,
      summary: typeof details.summary === "string" ? details.summary : null,
    };
  });
}

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import {
  bindLifetimeDiscount,
  LIFETIME_AUDIT_ENTITY,
  revokeLifetimeDiscount,
  type LifetimeBindOutcome,
  type LifetimeBindingRecord,
  type LifetimeRevokeOutcome,
  type LifetimeStore,
} from "./lifetime-core";
import { PLATFORM_ORG_ID } from "./promotions-admin";
import { PAID_ORDER_STATUSES } from "./service";

/**
 * Скидка навсегда с базой: привязка из fulfillPaidOrder, отмена и список
 * для ROOT (/root/promo-codes → «Скидки навсегда»). Правила — lifetime-core.ts.
 */

type BindingRow = {
  id: string;
  accountId: string;
  promoCodeId: string;
  code: string;
  kind: string;
  value: number;
  orderId: number;
  boundAt: Date;
  revokedAt: Date | null;
  revokedById: string | null;
};

function toRecord(row: BindingRow): LifetimeBindingRecord {
  return { ...row, kind: row.kind === "fixed" ? "fixed" : "percent" };
}

export const dbLifetimeStore: LifetimeStore = {
  findOrder: (orderId) =>
    db.paymentOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, promoCode: true, lifetimeDiscountId: true },
    }),
  async findCode(code) {
    const row = await db.promoCode.findUnique({
      where: { code },
      select: { id: true, code: true, kind: true, value: true, lifetime: true },
    });
    return row ? { ...row, kind: row.kind === "fixed" ? "fixed" : "percent" } : null;
  },
  async accountOfOrganization(organizationId) {
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { accountId: true } });
    return org?.accountId ?? null;
  },
  async findBinding(accountId) {
    const row = await db.accountLifetimeDiscount.findUnique({ where: { accountId } });
    return row ? toRecord(row) : null;
  },
  async findBindingById(id) {
    const row = await db.accountLifetimeDiscount.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  },
  async createBinding(data) {
    try {
      return toRecord(await db.accountLifetimeDiscount.create({ data }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
      throw error;
    }
  },
  async updateBinding(id, data) {
    return toRecord(await db.accountLifetimeDiscount.update({ where: { id }, data }));
  },
  async audit(entry) {
    try {
      await db.auditLog.create({
        data: {
          organizationId: entry.organizationId,
          userId: entry.actor?.id ?? null,
          userName: entry.actor?.name ?? null,
          action: entry.action,
          entity: LIFETIME_AUDIT_ENTITY,
          entityId: entry.bindingId,
          details: entry.details as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      // Аудит не должен ломать оплату — только лог.
      console.error("[audit] write failed", entry.action, error);
    }
  },
};

/**
 * Привязка после оплаты (зовёт fulfillPaidOrder). Никогда не бросает:
 * деньги уже получены, подписка продлена — сбой привязки разбирает ROOT
 * по логу `[promo] lifetime bind failed`.
 */
export async function bindLifetimeDiscountForOrder(
  orderId: number,
  organizationId: string | null
): Promise<LifetimeBindOutcome | null> {
  if (!organizationId) return null;
  try {
    return await bindLifetimeDiscount(dbLifetimeStore, { orderId, organizationId });
  } catch (error) {
    console.error(`[promo] lifetime bind failed order=${orderId} org=${organizationId}`, error);
    return null;
  }
}

/** Отмена ROOT'ом (с аудитом в организации platform). */
export async function revokeLifetimeDiscountById(
  id: string,
  actor: { id: string; name: string | null }
): Promise<LifetimeRevokeOutcome> {
  return revokeLifetimeDiscount(dbLifetimeStore, { id, actor, auditOrganizationId: PLATFORM_ORG_ID });
}

/** Строка раздела «Скидки навсегда» (сериализуется в клиентский компонент). */
export type LifetimeDiscountAdminRow = {
  id: string;
  accountId: string;
  ownerEmail: string | null;
  organizations: Array<{ id: string; name: string }>;
  code: string;
  kind: "percent" | "fixed";
  value: number;
  orderId: number;
  /** ISO. */
  boundAt: string;
  revokedAt: string | null;
  revokedByName: string | null;
  /** Оплат, к которым скидка применилась сама (продления). */
  autoPaidOrders: number;
};

export async function listLifetimeDiscountsForRoot(): Promise<LifetimeDiscountAdminRow[]> {
  const rows = await db.accountLifetimeDiscount.findMany({
    orderBy: { boundAt: "desc" },
    take: 500,
    include: {
      account: {
        select: {
          owner: { select: { email: true } },
          organizations: { select: { id: true, name: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (rows.length === 0) return [];
  const [auto, revokers] = await Promise.all([
    db.paymentOrder.groupBy({
      by: ["lifetimeDiscountId"],
      where: { lifetimeDiscountId: { in: rows.map((r) => r.id) }, status: { in: [...PAID_ORDER_STATUSES] } },
      _count: { _all: true },
    }),
    db.user.findMany({
      where: { id: { in: rows.map((r) => r.revokedById).filter((v): v is string => Boolean(v)) } },
      select: { id: true, name: true, email: true },
    }),
  ]);
  const autoById = new Map(auto.map((a) => [a.lifetimeDiscountId ?? "", a._count._all]));
  const revokerById = new Map(revokers.map((u) => [u.id, u.name || u.email]));
  return rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    ownerEmail: row.account?.owner.email ?? null,
    organizations: row.account?.organizations ?? [],
    code: row.code,
    kind: row.kind === "fixed" ? "fixed" : "percent",
    value: row.value,
    orderId: row.orderId,
    boundAt: row.boundAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedByName: row.revokedById ? (revokerById.get(row.revokedById) ?? null) : null,
    autoPaidOrders: autoById.get(row.id) ?? 0,
  }));
}

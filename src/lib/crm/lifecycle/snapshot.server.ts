import { Prisma } from "@prisma/client";

import { listBillingUnits, readTrialSettings, stateForUnit } from "@/lib/billing.server";
import { db } from "@/lib/db";
import { isTechnicalEmail } from "@/lib/technical-email";
import { isBillingCycle } from "@/lib/tariff-plans";
import { TOPUP_TARIFF_KEY } from "@/lib/balance/topup-core";

import { DAY_MS } from "./calendar";
import type { UsageSnapshot } from "./offer";
import type { PendingInvoice, UnitSnapshot } from "./planner";

/**
 * Снимки аккаунтов биллинга для автоворонки: состояние тарифа, как ведут
 * журналы, контакты владельца, ИНН, договор, счета. Собирается пачкой для
 * единиц, которым автоворонка сейчас нужна: пробный, грейс, окно продления,
 * открытая сделка, неоплаченный счёт или брошенная оплата картой.
 */

export type OwnerInfo = {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  telegramChatId: string | null;
};

export type SnapshotRow = {
  unit: UnitSnapshot;
  scopeOrgIds: string[];
  owner: OwnerInfo | null;
  accountManagerId: string | null;
  graceDays: number;
};

/** Счета автоворонки: ключи `lc:invoice:<id>` в журнале напоминаний. */
export const AUTO_INVOICE_PREFIX = "lc:invoice:";

const RENEWAL_LOOKAHEAD_DAYS = 35;

function legalInn(org: { inn: string | null; legalProfileJson: unknown }): boolean {
  if (org.inn?.trim()) return true;
  const profile = org.legalProfileJson as { inn?: unknown } | null;
  return typeof profile?.inn === "string" && profile.inn.trim().length >= 10;
}

function workEmail(user: { email: string; contactEmail: string | null }): string | null {
  return [user.contactEmail, user.email].map((value) => (value ?? "").trim()).find((value) => value.includes("@") && !isTechnicalEmail(value)) ?? null;
}

type UsageRow = { organizationId: string; entries7: bigint | number; entries14: bigint | number; lastAt: Date | null; journals: bigint | number };

/** Записи журналов по организациям за 14 дней: обычные журналы и журналы-сетки. */
async function usageByOrg(orgIds: string[], now: Date): Promise<Map<string, Omit<UsageSnapshot, "activeUsers" | "enabledJournals" | "pointsInUse" | "devices">>> {
  const result = new Map<string, Omit<UsageSnapshot, "activeUsers" | "enabledJournals" | "pointsInUse" | "devices">>();
  if (!orgIds.length) return result;
  const since14 = new Date(now.getTime() - 14 * DAY_MS);
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const [plain, grid] = await Promise.all([
    db.$queryRaw<UsageRow[]>(Prisma.sql`
      SELECT "organizationId",
             count(*) FILTER (WHERE "createdAt" >= ${since7}) AS "entries7",
             count(*) AS "entries14",
             max("createdAt") AS "lastAt",
             count(DISTINCT "templateId") AS "journals"
        FROM "JournalEntry"
       WHERE "organizationId" IN (${Prisma.join(orgIds)}) AND "createdAt" >= ${since14}
       GROUP BY "organizationId"`),
    db.$queryRaw<UsageRow[]>(Prisma.sql`
      SELECT d."organizationId",
             count(*) FILTER (WHERE e."createdAt" >= ${since7}) AS "entries7",
             count(*) AS "entries14",
             max(e."createdAt") AS "lastAt",
             count(DISTINCT d."templateId") AS "journals"
        FROM "JournalDocumentEntry" e
        JOIN "JournalDocument" d ON d."id" = e."documentId"
       WHERE d."organizationId" IN (${Prisma.join(orgIds)}) AND e."createdAt" >= ${since14}
       GROUP BY d."organizationId"`),
  ]);
  for (const row of [...plain, ...grid]) {
    const current = result.get(row.organizationId) ?? { entries7d: 0, entries14d: 0, journalsUsed14d: 0, lastEntryAt: null };
    current.entries7d += Number(row.entries7);
    current.entries14d += Number(row.entries14);
    current.journalsUsed14d += Number(row.journals);
    if (row.lastAt && (!current.lastEntryAt || row.lastAt > current.lastEntryAt)) current.lastEntryAt = row.lastAt;
    result.set(row.organizationId, current);
  }
  return result;
}

/**
 * Снимки для автоворонки на момент `now`. `onlyUnitKeys` — только эти
 * единицы (карточка клиента, прогноз).
 */
export async function loadLifecycleSnapshots(now: Date, onlyUnitKeys?: ReadonlySet<string>): Promise<SnapshotRow[]> {
  const trial = await readTrialSettings();
  const units = (await listBillingUnits()).filter((unit) => !onlyUnitKeys || onlyUnitKeys.has(unit.key));
  if (!units.length) return [];
  const allOrgIds = units.flatMap((unit) => unit.scopeOrgIds);

  // Кому автоворонка нужна сейчас: открытая сделка, счёт, оплата картой — или по состоянию тарифа.
  const [openDeals, pendingOrders] = await Promise.all([
    db.crmDeal.findMany({ where: { stage: { notIn: ["won", "lost"] } }, select: { unitKey: true } }),
    db.paymentOrder.findMany({
      where: {
        organizationId: { in: allOrgIds },
        status: "pending",
        tariffKey: { not: TOPUP_TARIFF_KEY },
        createdAt: { gte: new Date(now.getTime() - 45 * DAY_MS) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, organizationId: true, paymentMethod: true, createdAt: true, invoiceDueAt: true, amountRub: true },
    }),
  ]);
  const openUnitKeys = new Set(openDeals.map((deal) => deal.unitKey));
  const ordersByOrg = new Map<string, typeof pendingOrders>();
  for (const order of pendingOrders) {
    if (!order.organizationId) continue;
    ordersByOrg.set(order.organizationId, [...(ordersByOrg.get(order.organizationId) ?? []), order]);
  }

  const relevant = units
    .map((unit) => ({ unit, state: stateForUnit(unit, trial, now) }))
    .filter(({ unit, state }) => {
      if (state.kind === "exempt") return false;
      if (openUnitKeys.has(unit.key)) return true;
      if (unit.scopeOrgIds.some((id) => ordersByOrg.has(id))) return true;
      if (state.kind === "free_period" || state.kind === "needs_decision") return true;
      if (state.kind === "paid" && state.paidUntil) return state.paidUntil.getTime() - now.getTime() <= RENEWAL_LOOKAHEAD_DAYS * DAY_MS;
      // Ушёл на бесплатный — сделку закроет «Отказ» (она открыта — уже выше).
      return false;
    });
  if (!relevant.length) return [];

  const orgIds = relevant.flatMap(({ unit }) => unit.scopeOrgIds);
  const ownerIds = relevant.map(({ unit }) => unit.ownerUserId).filter((id): id is string => Boolean(id));
  const homeOrgIds = relevant.map(({ unit }) => unit.organizationId);
  const [usage, devices, owners, fallbackManagers, homeOrgs, contracts, autoInvoices, paidAfter] = await Promise.all([
    usageByOrg(orgIds, now),
    db.equipment.findMany({ where: { tuyaDeviceId: { not: null }, area: { organizationId: { in: orgIds } } }, select: { area: { select: { organizationId: true } } } }),
    db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true, contactEmail: true, phone: true, telegramChatId: true } }),
    db.user.findMany({
      where: { organizationId: { in: homeOrgIds }, isActive: true, archivedAt: null, isRoot: false, role: { in: ["owner", "manager", "head_chef", "technologist"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, organizationId: true, name: true, email: true, contactEmail: true, phone: true, telegramChatId: true },
    }),
    db.organization.findMany({ where: { id: { in: homeOrgIds } }, select: { id: true, inn: true, legalProfileJson: true, accountManagerId: true, phone: true } }),
    db.edoDocument.findMany({
      where: { organizationId: { in: orgIds }, kind: "contract", stateCode: 7, deletedAt: null },
      orderBy: { updatedAt: "asc" },
      select: { organizationId: true, refreshedAt: true, updatedAt: true },
    }),
    db.crmReminderLog.findMany({ where: { dedupeKey: { startsWith: AUTO_INVOICE_PREFIX } }, select: { dedupeKey: true } }),
    db.paymentOrder.findMany({
      where: { organizationId: { in: orgIds }, status: { in: ["paid", "completed"] }, createdAt: { gte: new Date(now.getTime() - 4 * DAY_MS) } },
      select: { organizationId: true, createdAt: true },
    }),
  ]);
  const devicesByOrg = new Map<string, number>();
  for (const device of devices) devicesByOrg.set(device.area.organizationId, (devicesByOrg.get(device.area.organizationId) ?? 0) + 1);
  const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
  const homeById = new Map(homeOrgs.map((org) => [org.id, org]));
  const autoIds = new Set(autoInvoices.map((row) => Number(row.dedupeKey.slice(AUTO_INVOICE_PREFIX.length))));
  const contractByOrg = new Map<string, Date>();
  for (const contract of contracts) if (!contractByOrg.has(contract.organizationId)) contractByOrg.set(contract.organizationId, contract.refreshedAt ?? contract.updatedAt);

  return relevant.map(({ unit, state }) => {
    const ownerRow =
      (unit.ownerUserId && ownerById.get(unit.ownerUserId)) || fallbackManagers.find((user) => user.organizationId === unit.organizationId) || null;
    const owner: OwnerInfo | null = ownerRow
      ? { userId: ownerRow.id, name: ownerRow.name, email: workEmail(ownerRow), phone: ownerRow.phone?.trim() || null, telegramChatId: ownerRow.telegramChatId }
      : null;
    const home = homeById.get(unit.organizationId);
    const merged = unit.scopeOrgIds.reduce(
      (acc, id) => {
        const row = usage.get(id);
        if (!row) return acc;
        acc.entries7d += row.entries7d;
        acc.entries14d += row.entries14d;
        acc.journalsUsed14d = Math.max(acc.journalsUsed14d, row.journalsUsed14d);
        if (row.lastEntryAt && (!acc.lastEntryAt || row.lastEntryAt > acc.lastEntryAt)) acc.lastEntryAt = row.lastEntryAt;
        return acc;
      },
      { entries7d: 0, entries14d: 0, journalsUsed14d: 0, lastEntryAt: null as Date | null },
    );
    const orders = unit.scopeOrgIds.flatMap((id) => ordersByOrg.get(id) ?? []);
    const invoices: PendingInvoice[] = orders
      .filter((order) => order.paymentMethod === "invoice")
      .map((order) => ({ id: order.id, createdAt: order.createdAt, dueAt: order.invoiceDueAt, amountRub: Number(order.amountRub), auto: autoIds.has(order.id) }));
    const lastCard = orders.find((order) => order.paymentMethod !== "invoice") ?? null;
    const paidSinceCard = lastCard ? paidAfter.some((row) => unit.scopeOrgIds.includes(row.organizationId ?? "") && row.createdAt > lastCard.createdAt) : false;
    const contractSignedAt = unit.scopeOrgIds.map((id) => contractByOrg.get(id)).filter((value): value is Date => Boolean(value)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const snapshot: UnitSnapshot = {
      unitKey: unit.key,
      organizationId: unit.organizationId,
      organizationName: unit.organizationName,
      accountCreatedAt: unit.createdAt,
      enforcement: trial.transitionEnabled,
      billing: {
        kind: state.kind,
        inactive: state.inactive,
        paidTier: state.paidTier,
        planCycle: isBillingCycle(unit.planCycle) ? unit.planCycle : "month",
        planPoints: unit.planPoints,
        paidUntil: state.paidUntil,
        subscriptionEnd: unit.subscriptionEnd,
        trialEndsAt: state.trialEndsAt,
        graceEndsAt: state.graceEndsAt,
        reason: state.reason,
      },
      usage: {
        activeUsers: unit.activeUsers,
        enabledJournals: unit.enabledJournals,
        pointsInUse: unit.pointsInUse,
        devices: unit.scopeOrgIds.reduce((sum, id) => sum + (devicesByOrg.get(id) ?? 0), 0),
        ...merged,
      },
      owner: { phone: Boolean(owner?.phone || home?.phone), telegram: Boolean(owner?.telegramChatId), email: Boolean(owner?.email) },
      hasInn: home ? legalInn(home) : false,
      contractSignedAt,
      invoices,
      abandonedCard: lastCard && !paidSinceCard ? { id: lastCard.id, createdAt: lastCard.createdAt, amountRub: Number(lastCard.amountRub) } : null,
    };
    return { unit: snapshot, scopeOrgIds: unit.scopeOrgIds, owner, accountManagerId: home?.accountManagerId ?? null, graceDays: trial.graceDays };
  });
}

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { CrmViewerScope } from "@/lib/crm/queries.server";
import { readPlanPricing } from "@/lib/tariffs";

import { addDays, atMsk, mskDay } from "./calendar";
import { renderClientMessage, renderTaskCopy } from "./copy";
import type { OfferSnapshot } from "./offer";
import { limitOf, loadPlatformStaff, pickAssignee } from "./people.server";
import { planLifecycle, type DealView } from "./planner";
import { readLifecycleSettings } from "./settings.server";
import { loadLifecycleSnapshots } from "./snapshot.server";
import { DEAL_STAGES, isDealKind, type DealStage } from "./stages";

/** Чтение для экранов воронки, задач и автоматизации. Охват «свои» — свои и свободные. */

function dealScope(scope?: CrmViewerScope): Prisma.CrmDealWhereInput {
  return scope?.own ? { OR: [{ ownerId: scope.userId }, { ownerId: null }] } : {};
}

function taskScope(scope?: CrmViewerScope): Prisma.CrmTaskWhereInput {
  return scope?.own ? { OR: [{ assigneeId: scope.userId }, { assigneeId: null }] } : {};
}

async function names(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name]));
}

export type FunnelCard = {
  id: string;
  kind: "trial" | "renewal";
  stage: DealStage;
  stageManual: boolean;
  organizationId: string;
  organizationName: string;
  contactId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  periodEnd: string | null;
  amountRub: number | null;
  offer: (OfferSnapshot & { sent?: { discountPercent: number; code: string | null; at: string } }) | null;
  contractSigned: boolean;
  messageSent: boolean;
  called: boolean;
  invoiceOrderId: number | null;
  approvalPending: boolean;
  nextTask: { id: string; title: string; dueAt: string; overdue: boolean } | null;
  openTasks: number;
  lostReason: string | null;
  updatedAt: string;
};

export type FunnelFilters = { kind?: string; owner?: string; closing?: string };

export async function loadFunnel(filters: FunnelFilters, scope?: CrmViewerScope, now = new Date()) {
  const where: Prisma.CrmDealWhereInput = { AND: [dealScope(scope)] };
  const and = where.AND as Prisma.CrmDealWhereInput[];
  if (isDealKind(filters.kind)) and.push({ kind: filters.kind });
  if (filters.owner === "me" && scope) and.push({ ownerId: scope.userId });
  else if (filters.owner === "none") and.push({ ownerId: null });
  else if (filters.owner && filters.owner !== "all") and.push({ ownerId: filters.owner });
  if (filters.closing === "7") and.push({ periodEnd: { lte: new Date(now.getTime() + 7 * 86_400_000) } });
  // Закрытые сделки — только за последние 30 дней, чтобы колонки не росли бесконечно.
  and.push({ OR: [{ stage: { notIn: ["won", "lost"] } }, { updatedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } }] });
  const deals = await db.crmDeal.findMany({
    where,
    orderBy: [{ periodEnd: "asc" }, { createdAt: "asc" }],
    take: 600,
    include: { tasks: { where: { status: "open" }, orderBy: { dueAt: "asc" }, select: { id: true, title: true, dueAt: true, kind: true } } },
  });
  const [orgs, owners] = await Promise.all([
    db.organization.findMany({ where: { id: { in: [...new Set(deals.map((deal) => deal.organizationId))] } }, select: { id: true, name: true } }),
    names(deals.map((deal) => deal.ownerId)),
  ]);
  const orgName = new Map(orgs.map((org) => [org.id, org.name]));
  const cards: FunnelCard[] = deals.map((deal) => {
    const next = deal.tasks.find((task) => task.kind !== "approval") ?? deal.tasks[0] ?? null;
    return {
      id: deal.id,
      kind: deal.kind === "renewal" ? "renewal" : "trial",
      stage: (DEAL_STAGES as readonly string[]).includes(deal.stage) ? (deal.stage as DealStage) : "registered",
      stageManual: deal.stageManual,
      organizationId: deal.organizationId,
      organizationName: orgName.get(deal.organizationId) ?? "Организация",
      contactId: deal.contactId,
      ownerId: deal.ownerId,
      ownerName: deal.ownerId ? (owners.get(deal.ownerId) ?? null) : null,
      periodEnd: deal.periodEnd?.toISOString() ?? null,
      amountRub: deal.amountRub,
      offer: (deal.offerJson as FunnelCard["offer"]) ?? null,
      contractSigned: Boolean(deal.contractSignedAt),
      messageSent: Boolean(deal.messageSentAt),
      called: Boolean(deal.calledAt),
      invoiceOrderId: deal.invoiceOrderId,
      approvalPending: deal.tasks.some((task) => task.kind === "approval"),
      nextTask: next ? { id: next.id, title: next.title, dueAt: next.dueAt.toISOString(), overdue: next.dueAt.getTime() < now.getTime() } : null,
      openTasks: deal.tasks.length,
      lostReason: deal.lostReason,
      updatedAt: deal.updatedAt.toISOString(),
    };
  });
  return { cards };
}

export type TaskRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  dueAt: string;
  status: string;
  result: string | null;
  resultNote: string | null;
  scenario: string;
  assigneeId: string | null;
  assigneeName: string | null;
  contactId: string | null;
  dealId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  completedAt: string | null;
  payload: Record<string, unknown> | null;
  /** Почта владельца аккаунта — получатель спец-КП по умолчанию. */
  clientEmail: string | null;
  /** Рекомендация сделки — заполнить форму спец-КП, если в задаче её нет. */
  dealOffer: Record<string, unknown> | null;
};

async function toTaskRows(tasks: Prisma.CrmTaskGetPayload<object>[]): Promise<TaskRow[]> {
  const dealIds = [...new Set(tasks.map((task) => task.dealId).filter((id): id is string => Boolean(id)))];
  const [assignees, orgs, contacts, deals] = await Promise.all([
    names(tasks.map((task) => task.assigneeId)),
    db.organization.findMany({ where: { id: { in: [...new Set(tasks.map((task) => task.organizationId).filter((id): id is string => Boolean(id)))] } }, select: { id: true, name: true } }),
    db.crmContact.findMany({ where: { id: { in: [...new Set(tasks.map((task) => task.contactId).filter((id): id is string => Boolean(id)))] } }, select: { id: true, email: true } }),
    dealIds.length ? db.crmDeal.findMany({ where: { id: { in: dealIds } }, select: { id: true, offerJson: true } }) : Promise.resolve([]),
  ]);
  const dealOffer = new Map(deals.map((deal) => [deal.id, (deal.offerJson as Record<string, unknown> | null) ?? null]));
  const orgName = new Map(orgs.map((org) => [org.id, org.name]));
  const contactEmail = new Map(contacts.map((contact) => [contact.id, contact.email]));
  return tasks.map((task) => ({
    id: task.id,
    kind: task.kind,
    title: task.title,
    body: task.body,
    dueAt: task.dueAt.toISOString(),
    status: task.status,
    result: task.result,
    resultNote: task.resultNote,
    scenario: task.scenario,
    assigneeId: task.assigneeId,
    assigneeName: task.assigneeId ? (assignees.get(task.assigneeId) ?? null) : null,
    contactId: task.contactId,
    dealId: task.dealId,
    organizationId: task.organizationId,
    organizationName: task.organizationId ? (orgName.get(task.organizationId) ?? null) : null,
    completedAt: task.completedAt?.toISOString() ?? null,
    payload: (task.payloadJson as Record<string, unknown> | null) ?? null,
    clientEmail: task.contactId ? (contactEmail.get(task.contactId) ?? null) : null,
    dealOffer: task.dealId ? (dealOffer.get(task.dealId) ?? null) : null,
  }));
}

export type TaskFilters = { who?: string; kind?: string };

export async function loadTasks(filters: TaskFilters, scope: CrmViewerScope) {
  const and: Prisma.CrmTaskWhereInput[] = [taskScope(scope)];
  if (filters.who === "all" && !scope.own) {
    // все
  } else if (filters.who === "none") and.push({ assigneeId: null });
  else and.push({ assigneeId: scope.userId });
  if (filters.kind && filters.kind !== "all") and.push({ kind: filters.kind });
  const [open, done] = await Promise.all([
    db.crmTask.findMany({ where: { AND: [...and, { status: "open" }] }, orderBy: { dueAt: "asc" }, take: 400 }),
    db.crmTask.findMany({ where: { AND: [...and, { status: { not: "open" } }, { completedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }] }, orderBy: { completedAt: "desc" }, take: 60 }),
  ]);
  return { open: await toTaskRows(open), done: await toTaskRows(done) };
}

/** Сделки и задачи контакта — панель в карточке. */
export async function loadContactPipeline(contactId: string, organizationId: string | null) {
  const or: Prisma.CrmDealWhereInput[] = [{ contactId }];
  if (organizationId) or.push({ organizationId });
  const deals = await db.crmDeal.findMany({ where: { OR: or }, orderBy: { createdAt: "desc" }, take: 6 });
  const tasks = await db.crmTask.findMany({
    where: { OR: [{ contactId }, ...(deals.length ? [{ dealId: { in: deals.map((deal) => deal.id) } }] : [])] },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    take: 40,
  });
  const owners = await names(deals.map((deal) => deal.ownerId));
  return {
    deals: deals.map((deal) => ({
      id: deal.id,
      kind: deal.kind,
      stage: deal.stage,
      stageManual: deal.stageManual,
      ownerId: deal.ownerId,
      ownerName: deal.ownerId ? (owners.get(deal.ownerId) ?? null) : null,
      periodEnd: deal.periodEnd?.toISOString() ?? null,
      amountRub: deal.amountRub,
      offer: (deal.offerJson as FunnelCard["offer"]) ?? null,
      contractSigned: Boolean(deal.contractSignedAt),
      messageSentAt: deal.messageSentAt?.toISOString() ?? null,
      calledAt: deal.calledAt?.toISOString() ?? null,
      invoiceOrderId: deal.invoiceOrderId,
      lostReason: deal.lostReason,
      organizationId: deal.organizationId,
    })),
    tasks: await toTaskRows(tasks),
  };
}

export async function loadTaskCounters(scope: CrmViewerScope, now = new Date()) {
  const mine: Prisma.CrmTaskWhereInput = scope.own ? { assigneeId: scope.userId } : {};
  const endOfToday = atMsk(mskDay(now), 23, 59);
  const [today, overdue, approvals, deals, closingSoon] = await Promise.all([
    db.crmTask.count({ where: { ...mine, status: "open", dueAt: { lte: endOfToday, gte: now } } }),
    db.crmTask.count({ where: { ...mine, status: "open", dueAt: { lt: now } } }),
    db.crmTask.count({ where: { ...mine, status: "open", kind: "approval" } }),
    db.crmDeal.groupBy({ by: ["stage"], where: { ...dealScope(scope), stage: { notIn: ["won", "lost"] } }, _count: { _all: true } }),
    db.crmDeal.count({ where: { ...dealScope(scope), stage: { notIn: ["won", "lost"] }, periodEnd: { lte: new Date(now.getTime() + 7 * 86_400_000) } } }),
  ]);
  return { today, overdue, approvals, openDeals: deals.reduce((sum, row) => sum + row._count._all, 0), closingSoon };
}

export type ForecastItem = { at: string; kind: "message" | "task"; organizationName: string; title: string; detail: string };

/**
 * Прогноз «если никто не оплатит»: что автоворонка напишет клиентам и какие
 * задачи поставит за N дней — тот же планировщик по сегодняшним снимкам,
 * ничего не записывает.
 */
export async function forecastLifecycle(days = 7, now = new Date()): Promise<ForecastItem[]> {
  const [settings, rows, staff, pricing] = await Promise.all([readLifecycleSettings(), loadLifecycleSnapshots(now), loadPlatformStaff(), readPlanPricing()]);
  if (!settings.enabled || !rows.length) return [];
  const deals = await db.crmDeal.findMany({ where: { unitKey: { in: rows.map((row) => row.unit.unitKey) } } });
  const dealsByUnit = new Map<string, DealView[]>();
  for (const deal of deals) {
    dealsByUnit.set(deal.unitKey, [
      ...(dealsByUnit.get(deal.unitKey) ?? []),
      { id: deal.id, dedupeKey: deal.dedupeKey, kind: deal.kind === "renewal" ? "renewal" : "trial", stage: deal.stage, stageManual: deal.stageManual, periodEnd: deal.periodEnd, offer: deal.offerJson as OfferSnapshot | null, contractSignedAt: deal.contractSignedAt },
    ]);
  }
  const [logs, tasks] = await Promise.all([
    db.crmReminderLog.findMany({ where: { dedupeKey: { startsWith: "lc:msg:" }, sentAt: { gte: new Date(now.getTime() - 120 * 86_400_000) } }, select: { dedupeKey: true } }),
    db.crmTask.findMany({ where: { dedupeKey: { startsWith: "lc:task:" }, createdAt: { gte: new Date(now.getTime() - 120 * 86_400_000) } }, select: { dedupeKey: true } }),
  ]);
  const done = new Set<string>([...logs.map((row) => row.dedupeKey), ...tasks.map((row) => row.dedupeKey ?? "")]);
  const items: ForecastItem[] = [];
  const today = mskDay(now);
  const moments: Date[] = [now];
  for (let day = 0; day <= days; day += 1) for (const hour of [10, 15, 21]) moments.push(atMsk(addDays(today, day), hour, 30));
  for (const moment of moments.filter((m) => m.getTime() >= now.getTime()).sort((a, b) => a.getTime() - b.getTime())) {
    for (const row of rows) {
      const unitDeals = dealsByUnit.get(row.unit.unitKey) ?? [];
      const assignee = pickAssignee(staff, { dealOwnerId: deals.find((deal) => deal.unitKey === row.unit.unitKey && deal.stage !== "won" && deal.stage !== "lost")?.ownerId, accountManagerId: row.accountManagerId, defaultAssigneeId: settings.defaultAssigneeId });
      const plan = planLifecycle({ unit: row.unit, deals: unitDeals, done, now: moment, settings, rates: pricing.rates, assigneeLimit: limitOf(staff, assignee) });
      if (plan.deal && !plan.deal.exists) {
        unitDeals.push({ id: plan.deal.key, dedupeKey: plan.deal.key, kind: plan.deal.kind, stage: "registered", stageManual: false, periodEnd: plan.deal.periodEnd, offer: plan.deal.offer, contractSignedAt: null });
        dealsByUnit.set(row.unit.unitKey, unitDeals);
      }
      for (const message of plan.messages) {
        done.add(message.key);
        const rendered = renderClientMessage(message, {
          orgName: row.unit.organizationName,
          recipientName: null,
          invoice: null,
          innMissing: false,
          manager: null,
          links: { pay: "", pricing: "", organization: "" },
          graceDays: row.graceDays,
        });
        items.push({ at: moment.toISOString(), kind: "message", organizationName: row.unit.organizationName, title: rendered.subject, detail: message.attachInvoice ? "письмо + счёт PDF" : "письмо" });
      }
      for (const task of plan.tasks) {
        done.add(task.key);
        const copy = renderTaskCopy(task, { orgName: row.unit.organizationName, contact: { name: null, phone: null, telegram: false, email: null }, messageSent: false, invoice: null, hasInn: row.unit.hasInn });
        const who = staff.find((person) => person.id === assignee)?.name ?? "без ответственного";
        items.push({ at: task.dueAt.toISOString(), kind: "task", organizationName: row.unit.organizationName, title: copy.title, detail: `задача: ${who}${task.approval.needed ? " · скидка на согласование" : ""}` });
      }
    }
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

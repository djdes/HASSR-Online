import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { CRM_ESCALATION_MS, QUIET_STAGES, isCrmStage } from "@/lib/crm/constants";
import { listMailboxes } from "@/lib/crm/mailbox.server";
import { loadDigestData } from "@/lib/crm/notify.server";
import { moscowDateKey } from "@/lib/crm/reminders";

/** Данные экранов CRM. Даты — ISO-строки: всё уходит в клиентские компоненты. */

const DAY = 24 * 60 * 60 * 1000;

export type CrmContactRow = {
  id: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  stage: string;
  source: string;
  ownerName: string | null;
  organizationId: string | null;
  awaitingSince: string | null;
  nextActionAt: string | null;
  nextActionNote: string | null;
  lastActivityAt: string;
  last: { channel: string; direction: string; body: string; occurredAt: string } | null;
};

const ROW_SELECT = {
  id: true,
  name: true,
  company: true,
  email: true,
  phone: true,
  stage: true,
  source: true,
  ownerId: true,
  organizationId: true,
  awaitingSince: true,
  nextActionAt: true,
  nextActionNote: true,
  lastActivityAt: true,
  interactions: {
    where: { filteredReason: null },
    orderBy: { occurredAt: "desc" },
    take: 1,
    select: { channel: true, direction: true, body: true, occurredAt: true },
  },
} satisfies Prisma.CrmContactSelect;

type RowSource = Prisma.CrmContactGetPayload<{ select: typeof ROW_SELECT }>;

async function ownerNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name]));
}

async function toRows(rows: RowSource[]): Promise<CrmContactRow[]> {
  const names = await ownerNames(rows.map((row) => row.ownerId));
  return rows.map((row) => {
    const last = row.interactions[0];
    return {
      id: row.id,
      name: row.name,
      company: row.company,
      email: row.email,
      phone: row.phone,
      stage: row.stage,
      source: row.source,
      ownerName: row.ownerId ? (names.get(row.ownerId) ?? null) : null,
      organizationId: row.organizationId,
      awaitingSince: row.awaitingSince?.toISOString() ?? null,
      nextActionAt: row.nextActionAt?.toISOString() ?? null,
      nextActionNote: row.nextActionNote,
      lastActivityAt: row.lastActivityAt.toISOString(),
      last: last ? { channel: last.channel, direction: last.direction, body: last.body.slice(0, 300), occurredAt: last.occurredAt.toISOString() } : null,
    };
  });
}

/**
 * Кто смотрит: охват «свои» (менеджер) — его контакты и свободные (без
 * ответственного, их можно «Взять себе»); иначе — все.
 */
export type CrmViewerScope = { userId: string; own: boolean };

export function crmContactScope(scope: CrmViewerScope | undefined): Prisma.CrmContactWhereInput {
  return scope?.own ? { OR: [{ ownerId: scope.userId }, { ownerId: null }] } : {};
}

function endOfMoscowDay(now: Date): Date {
  return new Date(new Date(`${moscowDateKey(now)}T00:00:00+03:00`).getTime() + DAY);
}

export async function loadCrmSummary(now = new Date(), scope?: CrmViewerScope) {
  const active = { stage: { notIn: [...QUIET_STAGES] } };
  const since30 = new Date(now.getTime() - 30 * DAY);
  const mine = crmContactScope(scope);
  const inScope = (where: Prisma.CrmContactWhereInput): Prisma.CrmContactWhereInput => ({ AND: [mine, where] });
  const interactionScope: Prisma.CrmInteractionWhereInput = scope?.own ? { contact: mine } : {};
  const [digest, awaiting, nextSteps, recent, channels, stages, mailboxes, cron, total] = await Promise.all([
    loadDigestData(now, mine),
    db.crmContact.findMany({ where: inScope({ ...active, awaitingSince: { not: null } }), orderBy: { awaitingSince: "asc" }, take: 8, select: ROW_SELECT }),
    db.crmContact.findMany({ where: inScope({ ...active, nextActionAt: { lt: endOfMoscowDay(now) } }), orderBy: { nextActionAt: "asc" }, take: 8, select: ROW_SELECT }),
    db.crmInteraction.findMany({
      where: { ...interactionScope, filteredReason: null, direction: { in: ["in", "event"] }, contactId: { not: null } },
      orderBy: { occurredAt: "desc" },
      take: 8,
      select: { id: true, channel: true, direction: true, subject: true, body: true, occurredAt: true, contact: { select: { id: true, name: true, company: true, email: true, phone: true } } },
    }),
    db.crmInteraction.groupBy({
      by: ["channel"],
      where: { ...interactionScope, filteredReason: null, direction: { in: ["in", "event"] }, occurredAt: { gte: since30 } },
      _count: { _all: true },
    }),
    db.crmContact.groupBy({ by: ["stage"], where: mine, _count: { _all: true } }),
    scope?.own ? Promise.resolve([]) : listMailboxes(),
    db.cronRunState.findUnique({ where: { job: "crm" } }),
    db.crmContact.count({ where: mine }),
  ]);
  return {
    digest,
    awaiting: await toRows(awaiting),
    nextSteps: await toRows(nextSteps),
    recent: recent.map((item) => ({
      id: item.id,
      channel: item.channel,
      direction: item.direction,
      subject: item.subject,
      body: item.body.slice(0, 300),
      occurredAt: item.occurredAt.toISOString(),
      contact: item.contact,
    })),
    channels: channels.map((row) => ({ channel: row.channel, count: row._count._all })).sort((a, b) => b.count - a.count),
    stages: Object.fromEntries(stages.map((row) => [row.stage, row._count._all])) as Record<string, number>,
    mailboxes,
    cron: cron ? { updatedAt: cron.updatedAt.toISOString(), failStreak: cron.failStreak, lastError: cron.lastError } : null,
    total,
    overdueBefore: new Date(now.getTime() - CRM_ESCALATION_MS).toISOString(),
  };
}

export const CRM_QUEUES = ["all", "awaiting", "waiting", "next", "leads", "clients"] as const;
export type CrmQueue = (typeof CRM_QUEUES)[number];

export type ContactFilters = { q?: string; queue?: string; stage?: string; channel?: string; owner?: string; page?: number };

const PAGE_SIZE = 50;

export async function listCrmContacts(filters: ContactFilters, viewerId: string, now = new Date(), own = false) {
  const where: Prisma.CrmContactWhereInput = {};
  const and: Prisma.CrmContactWhereInput[] = [crmContactScope({ userId: viewerId, own })];
  const q = filters.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
        { email: { contains: q.toLowerCase() } },
        ...(digits.length >= 4 ? [{ phoneKey: { contains: digits.slice(-10) } }] : []),
      ],
    });
  }
  switch (filters.queue) {
    case "awaiting":
      and.push({ awaitingSince: { not: null }, stage: { notIn: [...QUIET_STAGES] } });
      break;
    case "waiting":
      and.push({ awaitingSince: null, lastOutboundAt: { not: null }, stage: { in: ["new", "in_work"] } });
      break;
    case "next":
      and.push({ nextActionAt: { lt: endOfMoscowDay(now) }, stage: { notIn: [...QUIET_STAGES] } });
      break;
    case "leads":
      and.push({ organizationId: null, stage: { notIn: ["spam"] } });
      break;
    case "clients":
      and.push({ organizationId: { not: null } });
      break;
  }
  if (filters.stage && isCrmStage(filters.stage)) and.push({ stage: filters.stage });
  else if (filters.queue !== "awaiting" && filters.stage !== "all") and.push({ stage: { not: "spam" } });
  if (filters.channel) and.push({ source: filters.channel });
  if (filters.owner === "me") and.push({ ownerId: viewerId });
  if (filters.owner === "none") and.push({ ownerId: null });
  if (and.length) where.AND = and;
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const orderBy: Prisma.CrmContactOrderByWithRelationInput[] =
    filters.queue === "awaiting"
      ? [{ awaitingSince: "asc" }]
      : filters.queue === "next"
        ? [{ nextActionAt: "asc" }]
        : [{ lastActivityAt: "desc" }];
  const [rows, total] = await Promise.all([
    db.crmContact.findMany({ where, orderBy, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: ROW_SELECT }),
    db.crmContact.count({ where }),
  ]);
  return { rows: await toRows(rows), total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** Кого можно назначить ответственным: владелец платформы, раздел «CRM», РОП. Менеджер («свои») — только себя. */
export async function listCrmOwners(scope?: CrmViewerScope) {
  const users = await db.user.findMany({
    where: {
      isActive: true,
      archivedAt: null,
      ...(scope?.own ? { id: scope.userId } : { OR: [{ isRoot: true }, { platformSections: { has: "crm" } }, { platformSalesHead: true }] }),
    },
    orderBy: [{ platformSalesHead: "desc" }, { name: "asc" }],
    select: { id: true, name: true, platformSalesHead: true },
  });
  return users.map((user) => ({ id: user.id, name: user.name, salesHead: user.platformSalesHead }));
}

export async function loadCrmContact(id: string, scope?: CrmViewerScope) {
  const contact = await db.crmContact.findUnique({ where: { id } });
  if (!contact) return null;
  const [interactions, organization, owners, platformUser] = await Promise.all([
    db.crmInteraction.findMany({ where: { contactId: id }, orderBy: { occurredAt: "desc" }, take: 300 }),
    contact.organizationId
      ? db.organization.findUnique({ where: { id: contact.organizationId }, select: { id: true, name: true, subscriptionPlan: true, createdAt: true, accountManagerId: true } })
      : null,
    listCrmOwners(scope),
    contact.userId ? db.user.findUnique({ where: { id: contact.userId }, select: { id: true, name: true, email: true, phone: true } }) : null,
  ]);
  return {
    contact: {
      ...contact,
      lastInboundAt: contact.lastInboundAt?.toISOString() ?? null,
      lastOutboundAt: contact.lastOutboundAt?.toISOString() ?? null,
      lastActivityAt: contact.lastActivityAt.toISOString(),
      awaitingSince: contact.awaitingSince?.toISOString() ?? null,
      nextActionAt: contact.nextActionAt?.toISOString() ?? null,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    },
    interactions: interactions.map((item) => ({
      id: item.id,
      channel: item.channel,
      direction: item.direction,
      subject: item.subject,
      body: item.body,
      href: item.href,
      authorName: item.authorName,
      occurredAt: item.occurredAt.toISOString(),
    })),
    organization: organization
      ? {
          id: organization.id,
          name: organization.name,
          plan: organization.subscriptionPlan,
          createdAt: organization.createdAt.toISOString(),
          accountManagerId: organization.accountManagerId,
        }
      : null,
    platformUser,
    owners,
  };
}

export type CrmContactCard = NonNullable<Awaited<ReturnType<typeof loadCrmContact>>>;

export async function loadCrmMailPage(page = 1) {
  const take = 50;
  const where = { filteredReason: { not: null } } satisfies Prisma.CrmInteractionWhereInput;
  const [filtered, total, rules, mailboxes, reasons] = await Promise.all([
    db.crmInteraction.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (Math.max(1, page) - 1) * take,
      take,
      select: { id: true, fromAddress: true, fromName: true, subject: true, body: true, filteredReason: true, occurredAt: true },
    }),
    db.crmInteraction.count({ where }),
    db.crmSenderRule.findMany({ orderBy: { createdAt: "desc" } }),
    listMailboxes(),
    db.crmInteraction.groupBy({ by: ["filteredReason"], where, _count: { _all: true } }),
  ]);
  return {
    filtered: filtered.map((item) => ({ ...item, body: item.body.slice(0, 400), occurredAt: item.occurredAt.toISOString() })),
    total,
    page: Math.max(1, page),
    pages: Math.max(1, Math.ceil(total / take)),
    rules: rules.map((rule) => ({ id: rule.id, pattern: rule.pattern, action: rule.action, note: rule.note, createdAt: rule.createdAt.toISOString() })),
    mailboxes,
    reasons: reasons.map((row) => ({ reason: row.filteredReason ?? "", count: row._count._all })),
  };
}

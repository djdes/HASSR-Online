import type { MailingCampaign, Prisma } from "@prisma/client";

import { recordAuditLog } from "@/lib/audit-log";
import { db } from "@/lib/db";
import { normalizeSphere } from "@/lib/org-profile";
import { mskInputToDate, dateToMskInput } from "@/lib/promo/promotions";

import "./kinds";
import { normalizeSelection, planRecipients, type AudienceSelection, type PlanStats } from "./audience.server";
import { userMarketingEmail } from "./audience";
import { createChannelSenders } from "./channels.server";
import {
  CAMPAIGN_STATUS_LABELS,
  MAILING_CHANNELS,
  anyChannel,
  normalizeChannels,
  type CampaignStatus,
  type ChannelStatus,
  type MailingChannel,
  type MailingChannels,
} from "./labels";
import {
  buildRecipientContext,
  deliverRecipient,
  ensureUnsubscribe,
  type DeliverResult,
  type QueueCampaign,
} from "./queue";
import { readMailingSettings } from "./settings.server";
import {
  channelIs,
  channelSet,
  createPrismaQueueStore,
  loadQueueRecipient,
  refreshCampaignCounters,
} from "./store.server";
import { getMailingTemplate, type RenderedMailing } from "./templates";
import { newRecipientId, signRecipientToken } from "./tokens";
import { mailingAppUrl } from "./worker.server";

/**
 * Рассылки ROOT: черновики, запуск сейчас или по расписанию, отмена,
 * повтор неудачных, «тестовая отправка мне», предпросмотр и карточка.
 * Каждое действие — `[mailing] …` в логе и строка аудита (организация
 * platform), как в соседних ROOT-разделах.
 */

export const PLATFORM_ORG_ID = (process.env.PLATFORM_ORG_ID || "platform").trim();
export const MAILING_AUDIT_ENTITY = "MailingCampaign";

export type MailingActor = {
  request?: Request;
  session: { user: { id: string; name?: string | null; email?: string | null } };
};

export class MailingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

async function audit(actor: MailingActor, action: string, entityId: string | null, details: Record<string, unknown>) {
  await recordAuditLog({
    request: actor.request,
    session: actor.session,
    organizationId: PLATFORM_ORG_ID,
    action,
    entity: MAILING_AUDIT_ENTITY,
    entityId,
    details,
  });
}

function who(actor: MailingActor): string {
  return actor.session.user.email ?? actor.session.user.id;
}

// ------------------------------------------------------------------ drafts

export type CampaignAudience = AudienceSelection & {
  /** Последние фильтры вкладок — чтобы черновик открывался как был. */
  filters?: Record<string, unknown>;
  /** Итог планирования на момент запуска. */
  stats?: PlanStats;
};

export type DraftInput = {
  title: string;
  kind: string;
  channels: unknown;
  payload: unknown;
  audience: unknown;
};

function defaultTitle(now = new Date()): string {
  return `Рассылка ${now.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}`;
}

function normalizeAudience(raw: unknown): CampaignAudience {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const selection = normalizeSelection(r);
  const filters = r.filters && typeof r.filters === "object" ? (r.filters as Record<string, unknown>) : undefined;
  return { ...selection, ...(filters ? { filters } : {}) };
}

function draftData(input: DraftInput) {
  const template = getMailingTemplate(input.kind);
  if (!template) throw new MailingError(`Тип рассылки «${input.kind}» не найден`);
  const title = (input.title ?? "").trim().slice(0, 120) || defaultTitle();
  return {
    title,
    kind: template.kind,
    channels: normalizeChannels(input.channels) as unknown as Prisma.InputJsonValue,
    // Черновик хранит то, что ввели, даже недописанное: проверка — при запуске.
    payload: (input.payload ?? {}) as Prisma.InputJsonValue,
    audience: normalizeAudience(input.audience) as unknown as Prisma.InputJsonValue,
  };
}

export async function createDraft(input: DraftInput, actor: MailingActor) {
  const row = await db.mailingCampaign.create({
    data: {
      ...draftData(input),
      status: "draft",
      createdById: actor.session.user.id,
      createdByName: actor.session.user.name ?? actor.session.user.email ?? null,
    },
  });
  console.info(`[mailing] campaign=${row.id} draft created «${row.title}» by ${who(actor)}`);
  return row;
}

export async function updateDraft(id: string, input: DraftInput, actor: MailingActor) {
  const r = await db.mailingCampaign.updateMany({ where: { id, status: "draft" }, data: draftData(input) });
  if (r.count !== 1) throw new MailingError("Менять можно только черновик", 409);
  console.debug(`[mailing] campaign=${id} draft saved by ${who(actor)}`);
  return db.mailingCampaign.findUniqueOrThrow({ where: { id } });
}

export async function deleteDraft(id: string, actor: MailingActor) {
  const row = await db.mailingCampaign.findUnique({ where: { id }, select: { status: true, title: true } });
  if (!row) throw new MailingError("Рассылка не найдена", 404);
  if (row.status !== "draft") throw new MailingError("Удалить можно только черновик — отправленные остаются в истории", 409);
  await db.mailingCampaign.delete({ where: { id } });
  console.info(`[mailing] campaign=${id} draft deleted «${row.title}» by ${who(actor)}`);
  await audit(actor, "mailing.draft.delete", id, { title: row.title });
}

export type DraftDto = {
  id: string;
  title: string;
  kind: string;
  status: CampaignStatus;
  channels: MailingChannels;
  payload: unknown;
  audience: CampaignAudience;
};

export async function getDraft(id: string): Promise<DraftDto | null> {
  const row = await db.mailingCampaign.findUnique({ where: { id } });
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    status: row.status as CampaignStatus,
    channels: normalizeChannels(row.channels),
    payload: row.payload,
    audience: normalizeAudience(row.audience),
  };
}

// ------------------------------------------------------------------ list

export type CampaignListRow = {
  id: string;
  title: string;
  kind: string;
  kindLabel: string;
  channels: MailingChannels;
  status: CampaignStatus;
  statusLabel: string;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  createdByName: string | null;
  lastError: string | null;
  counts: { total: number; queued: number; sent: number; failed: number; skipped: number; cancelled: number; clicks: number };
  selection: { users: number; contacts: number };
};

export function toListRow(row: MailingCampaign): CampaignListRow {
  const audience = normalizeAudience(row.audience);
  const status = row.status as CampaignStatus;
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    kindLabel: getMailingTemplate(row.kind)?.label ?? row.kind,
    channels: normalizeChannels(row.channels),
    status,
    statusLabel: CAMPAIGN_STATUS_LABELS[status] ?? row.status,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByName,
    lastError: row.lastError,
    counts: {
      total: row.totalCount,
      queued: row.queuedCount,
      sent: row.sentCount,
      failed: row.failedCount,
      skipped: row.skippedCount,
      cancelled: row.cancelledCount,
      clicks: row.clickCount,
    },
    selection: { users: audience.userIds.length, contacts: audience.contactIds.length },
  };
}

export async function listCampaigns(limit = 100): Promise<CampaignListRow[]> {
  const rows = await db.mailingCampaign.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return rows.map(toListRow);
}

// ------------------------------------------------------------------ launch

function validated(kind: string, payload: unknown): unknown {
  const template = getMailingTemplate(kind);
  if (!template) throw new MailingError(`Тип рассылки «${kind}» не найден`);
  if (!template.validate) return payload;
  const v = template.validate(payload);
  if (!v.ok) throw new MailingError(v.error);
  return v.payload;
}

const SCHEDULE_MAX_DAYS = 60;

export async function launchCampaign(
  id: string,
  options: { mode: "now" | "schedule"; scheduledAtMsk?: string | null },
  actor: MailingActor
): Promise<{ campaign: CampaignListRow; stats: PlanStats }> {
  const campaign = await db.mailingCampaign.findUnique({ where: { id } });
  if (!campaign) throw new MailingError("Рассылка не найдена", 404);
  if (campaign.status !== "draft") throw new MailingError("Эта рассылка уже запущена", 409);
  const template = getMailingTemplate(campaign.kind);
  if (!template) throw new MailingError(`Тип рассылки «${campaign.kind}» не найден`);
  const payload = validated(campaign.kind, campaign.payload);
  const channels = normalizeChannels(campaign.channels);
  if (!anyChannel(channels)) throw new MailingError("Отметьте хотя бы один канал");
  const audience = normalizeAudience(campaign.audience);
  if (audience.userIds.length + audience.contactIds.length === 0) {
    throw new MailingError("Выберите получателей на вкладках «Пользователи» или «Контакты»");
  }

  const now = new Date();
  let scheduledAt: Date | null = null;
  if (options.mode === "schedule") {
    scheduledAt = options.scheduledAtMsk ? mskInputToDate(options.scheduledAtMsk) : null;
    if (!scheduledAt) throw new MailingError("Укажите дату и время по Москве");
    if (scheduledAt.getTime() < now.getTime() + 60_000) {
      throw new MailingError("Время отправки — хотя бы через минуту от текущего");
    }
    if (scheduledAt.getTime() > now.getTime() + SCHEDULE_MAX_DAYS * 86_400_000) {
      throw new MailingError(`Запланировать можно не дальше чем на ${SCHEDULE_MAX_DAYS} дней`);
    }
  }

  const plan = await planRecipients(audience, channels);
  if (plan.drafts.length === 0) {
    throw new MailingError("Некому отправлять: выбранные получатели не подходят ни под один отмеченный канал");
  }
  const status: CampaignStatus = options.mode === "schedule" ? "scheduled" : "sending";
  await db.$transaction(
    async (tx) => {
      const r = await tx.mailingCampaign.updateMany({
        where: { id, status: "draft" },
        data: {
          status,
          payload: payload as Prisma.InputJsonValue,
          scheduledAt,
          startedAt: status === "sending" ? now : null,
          // Без prepare шаблону готовить нечего — очередь начинает сразу.
          preparedAt: template.prepare ? null : now,
          lastError: null,
          audience: { ...audience, stats: plan.stats } as unknown as Prisma.InputJsonValue,
        },
      });
      if (r.count !== 1) throw new MailingError("Эта рассылка уже запущена", 409);
      for (let i = 0; i < plan.drafts.length; i += 1000) {
        await tx.mailingRecipient.createMany({
          data: plan.drafts.slice(i, i + 1000).map((d) => ({ ...d, campaignId: id })),
        });
      }
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
  await refreshCampaignCounters(id);
  const fresh = await db.mailingCampaign.findUniqueOrThrow({ where: { id } });
  const summary = {
    title: fresh.title,
    kind: fresh.kind,
    channels: MAILING_CHANNELS.filter((c) => channels[c]),
    recipients: plan.stats.recipients,
    users: plan.stats.users,
    contacts: plan.stats.contacts,
    emailQueued: plan.stats.channels.email.queued,
    scheduledAt: scheduledAt?.toISOString() ?? null,
  };
  console.info(
    `[mailing] campaign=${id} status draft → ${status} recipients=${plan.stats.recipients} by ${who(actor)}`,
    summary
  );
  await audit(actor, status === "scheduled" ? "mailing.campaign.schedule" : "mailing.campaign.launch", id, summary);
  return { campaign: toListRow(fresh), stats: plan.stats };
}

// ------------------------------------------------------------------ cancel / retry

export async function cancelCampaign(id: string, actor: MailingActor): Promise<CampaignListRow> {
  const campaign = await db.mailingCampaign.findUnique({ where: { id } });
  if (!campaign) throw new MailingError("Рассылка не найдена", 404);
  const r = await db.mailingCampaign.updateMany({
    where: { id, status: { in: ["scheduled", "sending"] } },
    data: { status: "cancelled", cancelledAt: new Date() },
  });
  if (r.count !== 1) throw new MailingError("Отменить можно только запланированную или идущую рассылку", 409);
  for (const c of MAILING_CHANNELS) {
    await db.mailingRecipient.updateMany({
      where: { AND: [{ campaignId: id, isTest: false }, channelIs(c, "queued")] },
      data: channelSet(c, "skipped", "Рассылка отменена"),
    });
  }
  // Кому что-то уже ушло — «отправлено», остальным — «отменено».
  await db.mailingRecipient.updateMany({
    where: {
      campaignId: id,
      isTest: false,
      status: "queued",
      OR: MAILING_CHANNELS.map((c) => channelIs(c, "sent")),
    },
    data: { status: "sent" },
  });
  const cancelled = await db.mailingRecipient.updateMany({
    where: { campaignId: id, isTest: false, status: "queued", NOT: MAILING_CHANNELS.map((c) => channelIs(c, "sending")) },
    data: { status: "cancelled", nextAttemptAt: null },
  });
  await refreshCampaignCounters(id);
  const fresh = await db.mailingCampaign.findUniqueOrThrow({ where: { id } });
  console.info(`[mailing] campaign=${id} status ${campaign.status} → cancelled (не отправлено: ${cancelled.count}) by ${who(actor)}`);
  await audit(actor, "mailing.campaign.cancel", id, {
    title: fresh.title,
    from: campaign.status,
    notSent: cancelled.count,
    sent: fresh.sentCount,
  });
  return toListRow(fresh);
}

export async function retryFailed(id: string, actor: MailingActor): Promise<{ campaign: CampaignListRow; requeued: number }> {
  const campaign = await db.mailingCampaign.findUnique({ where: { id } });
  if (!campaign) throw new MailingError("Рассылка не найдена", 404);
  if (campaign.status !== "sending" && campaign.status !== "done") {
    throw new MailingError("Повторить можно для идущей или завершённой рассылки", 409);
  }
  const failed = await db.mailingRecipient.findMany({
    where: { campaignId: id, isTest: false, OR: MAILING_CHANNELS.map((c) => channelIs(c, "failed")) },
    select: { id: true },
  });
  if (failed.length === 0) throw new MailingError("Неудачных отправок нет");
  const ids = failed.map((f) => f.id);
  for (const c of MAILING_CHANNELS) {
    await db.mailingRecipient.updateMany({
      where: { AND: [{ id: { in: ids } }, channelIs(c, "failed")] },
      data: channelSet(c, "queued", null),
    });
  }
  await db.mailingRecipient.updateMany({
    where: { id: { in: ids } },
    data: { status: "queued", attempts: 0, nextAttemptAt: null },
  });
  await db.mailingCampaign.updateMany({
    where: { id, status: "done" },
    data: { status: "sending", finishedAt: null },
  });
  await refreshCampaignCounters(id);
  const fresh = await db.mailingCampaign.findUniqueOrThrow({ where: { id } });
  console.info(`[mailing] campaign=${id} retry failed: ${ids.length} recipients → queued by ${who(actor)}`);
  await audit(actor, "mailing.campaign.retry", id, { title: fresh.title, requeued: ids.length });
  return { campaign: toListRow(fresh), requeued: ids.length };
}

// ------------------------------------------------------------------ card

export type RecipientDto = {
  id: string;
  kind: "user" | "contact";
  name: string | null;
  email: string | null;
  companyName: string | null;
  status: string;
  channels: Partial<Record<MailingChannel, { status: ChannelStatus; error: string | null }>>;
  attempts: number;
  sentAt: string | null;
  clickedAt: string | null;
  clickCount: number;
  unsubscribedAt: string | null;
  dryRun: boolean;
  isTest: boolean;
};

export type ChannelBreakdown = Record<MailingChannel, Partial<Record<ChannelStatus, number>>>;

export type CampaignCard = {
  campaign: CampaignListRow;
  payload: unknown;
  stats: PlanStats | null;
  channelBreakdown: ChannelBreakdown;
  recipients: RecipientDto[];
  total: number;
  scheduledAtMsk: string | null;
};

export type RecipientFilter = "all" | "queued" | "sent" | "failed" | "skipped" | "cancelled" | "clicked" | "test";

export async function getCampaignCard(
  id: string,
  options: { filter?: RecipientFilter; search?: string; offset?: number; limit?: number } = {}
): Promise<CampaignCard | null> {
  const row = await db.mailingCampaign.findUnique({ where: { id } });
  if (!row) return null;
  const filter = options.filter ?? "all";
  const where: Prisma.MailingRecipientWhereInput = { campaignId: id };
  if (filter === "test") where.isTest = true;
  else {
    where.isTest = false;
    if (filter === "clicked") where.clickedAt = { not: null };
    else if (filter !== "all") where.status = filter;
  }
  const search = (options.search ?? "").trim();
  if (search) {
    where.OR = [
      { email: { contains: search.toLowerCase() } },
      { name: { contains: search, mode: "insensitive" } },
      { companyName: { contains: search, mode: "insensitive" } },
    ];
  }
  const [recipients, total, breakdownRows] = await Promise.all([
    db.mailingRecipient.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: Math.max(0, options.offset ?? 0),
      take: Math.min(200, Math.max(1, options.limit ?? 50)),
    }),
    db.mailingRecipient.count({ where }),
    Promise.all(
      MAILING_CHANNELS.map((c) =>
        db.mailingRecipient.groupBy({
          by: [`${c}Status` as "emailStatus"],
          where: { campaignId: id, isTest: false },
          _count: { _all: true },
        })
      )
    ),
  ]);
  const channelBreakdown = {} as ChannelBreakdown;
  MAILING_CHANNELS.forEach((c, i) => {
    const counts: Partial<Record<ChannelStatus, number>> = {};
    for (const g of breakdownRows[i] as Array<Record<string, unknown> & { _count: { _all: number } }>) {
      const status = g[`${c}Status`];
      if (typeof status === "string") counts[status as ChannelStatus] = g._count._all;
    }
    channelBreakdown[c] = counts;
  });
  const audience = row.audience && typeof row.audience === "object" ? (row.audience as Record<string, unknown>) : {};
  return {
    campaign: toListRow(row),
    payload: row.payload,
    stats: (audience.stats as PlanStats | undefined) ?? null,
    channelBreakdown,
    total,
    scheduledAtMsk: row.scheduledAt ? dateToMskInput(row.scheduledAt) : null,
    recipients: recipients.map((r) => {
      const channels: RecipientDto["channels"] = {};
      for (const c of MAILING_CHANNELS) {
        const status = r[`${c}Status`] as ChannelStatus | null;
        if (status) channels[c] = { status, error: (r[`${c}Error`] as string | null) ?? null };
      }
      return {
        id: r.id,
        kind: r.contactId ? "contact" : "user",
        name: r.name,
        email: r.email,
        companyName: r.companyName,
        status: r.status,
        channels,
        attempts: r.attempts,
        sentAt: r.sentAt?.toISOString() ?? null,
        clickedAt: r.clickedAt?.toISOString() ?? null,
        clickCount: r.clickCount,
        unsubscribedAt: r.unsubscribedAt?.toISOString() ?? null,
        dryRun: r.dryRun,
        isTest: r.isTest,
      };
    }),
  };
}

// ------------------------------------------------------------------ preview & test

export type PreviewRecipient = { type: "user" | "contact"; id: string } | null;

const SAMPLE = {
  name: "Иван Петров",
  companyName: "Кафе «Ромашка»",
  sphere: "cafe",
  email: "ivan@example.ru",
};

export async function previewMailing(input: {
  kind: string;
  payload: unknown;
  recipient: PreviewRecipient;
}): Promise<{ label: string; rendered: RenderedMailing }> {
  const template = getMailingTemplate(input.kind);
  if (!template) throw new MailingError(`Тип рассылки «${input.kind}» не найден`);
  const payload = validated(input.kind, input.payload);
  let person: { name: string | null; companyName: string | null; sphere: string | null; email: string | null; userId: string | null; contactId: string | null; organizationId: string | null } = {
    ...SAMPLE,
    userId: null,
    contactId: null,
    organizationId: null,
  };
  let label = "Пример: Иван Петров, Кафе «Ромашка»";
  if (input.recipient?.type === "user") {
    const u = await db.user.findUnique({
      where: { id: input.recipient.id },
      select: { id: true, name: true, email: true, contactEmail: true, organizationId: true, organization: { select: { name: true, type: true } } },
    });
    if (u) {
      person = {
        name: u.name,
        companyName: u.organization.name,
        sphere: normalizeSphere(u.organization.type),
        email: userMarketingEmail(u),
        userId: u.id,
        contactId: null,
        organizationId: u.organizationId,
      };
      label = `${u.name} · ${u.organization.name}`;
    }
  } else if (input.recipient?.type === "contact") {
    const c = await db.marketingContact.findUnique({ where: { id: input.recipient.id } });
    if (c) {
      person = { name: c.name, companyName: c.company, sphere: c.sphere, email: c.email, userId: null, contactId: c.id, organizationId: null };
      label = [c.name, c.company, c.email].filter(Boolean).join(" · ");
    }
  }
  const { ctx } = buildRecipientContext(
    { id: "preview", token: "preview", links: [], payload: {}, ...person },
    mailingAppUrl(),
    { track: false }
  );
  const rendered = await template.render(payload, ctx);
  if (rendered.email) rendered.email = ensureUnsubscribe(rendered.email, ctx.unsubscribeUrl);
  return { label, rendered };
}

export type TestSendResult = {
  recipientId: string;
  channels: DeliverResult["channels"];
  email: string | null;
};

/** «Тестовая отправка мне» — во все отмеченные каналы текущему ROOT, сразу. */
export async function sendTestToMe(campaignId: string, actor: MailingActor): Promise<TestSendResult> {
  const campaign = await db.mailingCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new MailingError("Сначала сохраните черновик", 404);
  const payload = validated(campaign.kind, campaign.payload);
  const channels = normalizeChannels(campaign.channels);
  if (!anyChannel(channels)) throw new MailingError("Отметьте хотя бы один канал");
  const me = await db.user.findUnique({
    where: { id: actor.session.user.id },
    select: { id: true, name: true, email: true, contactEmail: true, organizationId: true, organization: { select: { name: true, type: true } } },
  });
  if (!me) throw new MailingError("Пользователь не найден", 404);
  const email = userMarketingEmail(me);
  const id = newRecipientId();
  const status = (on: boolean): ChannelStatus | null => (on ? "queued" : null);
  await db.mailingRecipient.create({
    data: {
      id,
      token: signRecipientToken(id),
      campaignId,
      isTest: true,
      userId: me.id,
      email,
      name: me.name,
      companyName: me.organization.name,
      sphere: normalizeSphere(me.organization.type),
      organizationId: me.organizationId,
      emailStatus: status(channels.email),
      inAppStatus: status(channels.inApp),
      pushStatus: status(channels.push),
      telegramStatus: status(channels.telegram),
    },
  });
  const recipient = await loadQueueRecipient(id);
  if (!recipient) throw new MailingError("Не удалось создать тестового получателя", 500);
  const queueCampaign: QueueCampaign = { id: campaign.id, kind: campaign.kind, payload, status: campaign.status };
  const result = await deliverRecipient(
    recipient,
    queueCampaign,
    {
      store: createPrismaQueueStore(),
      senders: createChannelSenders(),
      settings: await readMailingSettings(),
      appUrl: mailingAppUrl(),
    },
    {
      test: true,
      emailBudget: { remaining: 1 },
      gate: { suppressed: new Set(), optedOut: new Set(), contactStatus: new Map() },
    }
  );
  const summary = Object.fromEntries(
    Object.entries(result.channels).map(([c, v]) => [c, v ? `${v.status}${v.error ? `: ${v.error}` : ""}` : null])
  );
  console.info(`[mailing] campaign=${campaignId} test send to ${who(actor)}`, summary);
  await audit(actor, "mailing.campaign.test", campaignId, { title: campaign.title, to: email, channels: summary });
  return { recipientId: id, channels: result.channels, email };
}

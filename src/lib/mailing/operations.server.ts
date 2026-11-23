import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import { toListRow, type CampaignListRow } from "./campaigns.server";
import { emailForecastLimits, humanMsk, planQueue } from "./forecast";
import {
  CHANNEL_LABELS,
  CHANNEL_STATUS_LABELS,
  MAILING_CHANNELS,
  RECIPIENT_STATUS_LABELS,
  WAIT_REASONS,
  waitReasonLabel,
  type ChannelStatus,
  type MailingChannel,
} from "./labels";
import { queueVerdict, summarizeQueue, type QueueIssue, type QueueSummary } from "./queue-state";
import { PER_HOUR_MAX, type MailingSettings } from "./rate-limit";
import { emailSendStats, readMailingSettings, readWorkerHeartbeat } from "./settings.server";

/**
 * Наблюдение за отправкой — как в рассылках YesBeat: «Состояние очереди»
 * рассылки с прогнозом окончания, вкладка «Сейчас идут» и «Журнал
 * отправки» (кто, когда, что, статус, причина) с выгрузкой в CSV.
 * Только чтение.
 */

const ACTIVE = ["scheduled", "sending"];

// ------------------------------------------------------------------ forecast

export type CampaignForecast = {
  /** Примерный конец по Москве («12 ноя, 18:40»); пусто — ничего не ждёт. */
  finishHuman: string;
  finishAt: string | null;
  /** Писем других рассылок, стоящих в очереди раньше. */
  ahead: number;
  perHour: number;
  perDay: number;
  capped: boolean;
};

async function campaignForecast(
  campaign: { id: string; status: string; startedAt: Date | null; scheduledAt: Date | null; createdAt: Date; windowStart: number; windowEnd: number; channels: unknown },
  settings: MailingSettings,
  sentToday: number,
  now: Date,
  nextAt: string | null
): Promise<CampaignForecast | null> {
  if (!ACTIVE.includes(campaign.status)) return null;
  const mine = await db.mailingRecipient.count({ where: { campaignId: campaign.id, isTest: false, emailStatus: "queued" } });
  const anyQueued = mine > 0 || (await db.mailingRecipient.count({ where: { campaignId: campaign.id, isTest: false, status: "queued" } })) > 0;
  if (!anyQueued) return null;
  // Общая очередь писем: раньше уйдут письма рассылок, запущенных раньше этой.
  const startedAt = campaign.startedAt ?? campaign.scheduledAt ?? campaign.createdAt;
  const ahead = await db.mailingRecipient.count({
    where: {
      isTest: false,
      emailStatus: "queued",
      campaignId: { not: campaign.id },
      campaign: { status: "sending", startedAt: { lt: startedAt } },
    },
  });
  const window = { windowStart: campaign.windowStart, windowEnd: campaign.windowEnd };
  // Без писем лимиты почты не действуют — остальные каналы уходят за проход.
  const limits =
    mine > 0
      ? emailForecastLimits(settings, sentToday, window)
      : { perHour: PER_HOUR_MAX, perDay: PER_HOUR_MAX * 24, usedToday: 0, ...window };
  const fromMs = Math.max(now.getTime(), campaign.scheduledAt?.getTime() ?? 0, nextAt ? new Date(nextAt).getTime() : 0);
  const total = mine > 0 ? mine + ahead : 1;
  const plan = planQueue(total, new Date(fromMs), limits);
  return {
    finishHuman: plan.finishAt ? humanMsk(plan.finishAt) : "",
    finishAt: plan.finishAt?.toISOString() ?? null,
    ahead: mine > 0 ? ahead : 0,
    perHour: plan.perHour,
    perDay: plan.perDay,
    capped: plan.capped,
  };
}

// ------------------------------------------------------------------ queue state

export type QueueState = QueueSummary & {
  issues: QueueIssue[];
  heartbeat: string | null;
  stale: boolean;
  enabled: boolean;
  forecast: CampaignForecast | null;
  now: string;
};

export async function getQueueState(id: string, now: Date = new Date()): Promise<QueueState | null> {
  const campaign = await db.mailingCampaign.findUnique({ where: { id } });
  if (!campaign) return null;
  const [rows, settings, stats, heartbeat] = await Promise.all([
    db.mailingRecipient.findMany({
      where: { campaignId: id, isTest: false, status: "queued" },
      select: { waitReason: true, nextAttemptAt: true, emailStatus: true },
    }),
    readMailingSettings(),
    emailSendStats(now),
    readWorkerHeartbeat(),
  ]);
  const summary = summarizeQueue(
    rows.map((r) => ({ waitReason: r.waitReason, nextAttemptAt: r.nextAttemptAt, emailQueued: r.emailStatus === "queued" })),
    now
  );
  const heartbeatAt = heartbeat ? new Date(heartbeat.lastRunAt) : null;
  const verdict = queueVerdict({
    status: campaign.status,
    scheduledAt: campaign.scheduledAt,
    pausedBy: campaign.pausedBy,
    summary,
    enabled: settings.enabled,
    heartbeat: heartbeatAt,
    perDay: settings.perDay,
    sentToday: stats.today,
    windowStart: campaign.windowStart,
    windowEnd: campaign.windowEnd,
    now,
  });
  return {
    ...summary,
    issues: verdict.issues,
    stale: verdict.stale,
    heartbeat: heartbeat?.lastRunAt ?? null,
    enabled: settings.enabled,
    forecast: await campaignForecast(campaign, settings, stats.today, now, summary.nextAt),
    now: now.toISOString(),
  };
}

// ------------------------------------------------------------------ monitor

export type MonitorRow = CampaignListRow & {
  nextAt: string | null;
  finishHuman: string;
};

export type MonitorData = {
  rows: MonitorRow[];
  enabled: boolean;
  heartbeat: string | null;
  stale: boolean;
  settings: MailingSettings;
  sentToday: number;
};

/** «Сейчас идут»: запланированные, идущие и на паузе, плюс завершённые за 3 дня. */
export async function monitorCampaigns(now: Date = new Date()): Promise<MonitorData> {
  const since = new Date(now.getTime() - 3 * 86_400_000);
  const [campaigns, settings, stats, heartbeat] = await Promise.all([
    db.mailingCampaign.findMany({
      where: {
        OR: [
          { status: { in: ["scheduled", "sending", "paused"] } },
          { status: "done", finishedAt: { gte: since } },
          { status: "cancelled", cancelledAt: { gte: since } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    readMailingSettings(),
    emailSendStats(now),
    readWorkerHeartbeat(),
  ]);
  const order = ["sending", "scheduled", "paused", "done", "cancelled"];
  campaigns.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  const next = campaigns.length
    ? await db.mailingRecipient.groupBy({
        by: ["campaignId"],
        where: { campaignId: { in: campaigns.map((c) => c.id) }, isTest: false, status: "queued" },
        _min: { nextAttemptAt: true },
      })
    : [];
  const nextBy = new Map(next.map((n) => [n.campaignId, n._min.nextAttemptAt]));
  const rows: MonitorRow[] = [];
  for (const c of campaigns) {
    const n = nextBy.get(c.id);
    const nextAt = n ? new Date(Math.max(n.getTime(), now.getTime())).toISOString() : null;
    let finishHuman = "";
    if (c.queuedCount > 0 && ACTIVE.includes(c.status)) {
      try {
        finishHuman = (await campaignForecast(c, settings, stats.today, now, nextAt))?.finishHuman ?? "";
      } catch (error) {
        console.error(`[mailing] forecast campaign=${c.id} failed`, error);
      }
    }
    rows.push({ ...toListRow(c), nextAt, finishHuman });
  }
  const heartbeatAt = heartbeat ? new Date(heartbeat.lastRunAt).getTime() : 0;
  return {
    rows,
    enabled: settings.enabled,
    heartbeat: heartbeat?.lastRunAt ?? null,
    stale: !heartbeatAt || heartbeatAt < now.getTime() - 5 * 60_000,
    settings,
    sentToday: stats.today,
  };
}

// ------------------------------------------------------------------ journal

export const JOURNAL_STATUSES = ["planned", "sent", "failed", "skipped", "cancelled", "clicked", "unsubscribed"] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export const JOURNAL_STATUS_LABELS: Record<JournalStatus, string> = {
  planned: "Запланировано и в очереди",
  sent: "Отправлено",
  failed: "Ошибка",
  skipped: "Пропущено",
  cancelled: "Отменено",
  clicked: "Перешли по ссылке",
  unsubscribed: "Отписались",
};

export type JournalFilters = {
  campaign: string;
  status: JournalStatus | "";
  reason: string;
  search: string;
  /** «ГГГГ-ММ-ДД» по Москве. */
  from: string;
  to: string;
  page: number;
};

export const JOURNAL_PAGE = 50;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function journalDate(value: unknown): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!DATE_RE.test(v)) return "";
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? "" : v;
}

export function normalizeJournalFilters(raw: Record<string, unknown>): JournalFilters {
  const status = typeof raw.status === "string" && (JOURNAL_STATUSES as readonly string[]).includes(raw.status) ? (raw.status as JournalStatus) : "";
  const reason =
    typeof raw.reason === "string" && ((WAIT_REASONS as readonly string[]).includes(raw.reason) || raw.reason === "none") ? raw.reason : "";
  let from = journalDate(raw.from);
  let to = journalDate(raw.to);
  if (from && to && from > to) [from, to] = [to, from];
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(raw.page) || 1)));
  return {
    campaign: typeof raw.campaign === "string" && /^[a-z0-9]{1,40}$/i.test(raw.campaign) ? raw.campaign : "",
    status,
    reason,
    search: typeof raw.search === "string" ? raw.search.trim().slice(0, 100) : "",
    from,
    to,
    page,
  };
}

/** Начало дня по Москве. */
function mskDay(date: string, endOfDay = false): Date {
  const start = new Date(`${date}T00:00:00Z`).getTime() - 3 * 60 * 60 * 1000;
  return new Date(endOfDay ? start + 86_400_000 - 1 : start);
}

function journalWhere(f: JournalFilters): Prisma.MailingRecipientWhereInput {
  const and: Prisma.MailingRecipientWhereInput[] = [{ isTest: false }];
  if (f.campaign) and.push({ campaignId: f.campaign });
  else and.push({ campaign: { status: { not: "draft" } } });
  if (f.status === "planned") and.push({ status: "queued" });
  else if (f.status === "clicked") and.push({ clickedAt: { not: null } });
  else if (f.status === "unsubscribed") and.push({ unsubscribedAt: { not: null } });
  else if (f.status) and.push({ status: f.status });
  if (f.reason === "none") and.push({ status: "queued", waitReason: null });
  else if (f.reason) and.push({ status: "queued", waitReason: f.reason });
  if (f.search) {
    const or: Prisma.MailingRecipientWhereInput[] = [
      { email: { contains: f.search.toLowerCase() } },
      { name: { contains: f.search, mode: "insensitive" } },
      { companyName: { contains: f.search, mode: "insensitive" } },
    ];
    if (/^c[a-z0-9]{20,}$/i.test(f.search)) or.push({ userId: f.search }, { contactId: f.search });
    and.push({ OR: or });
  }
  if (f.from || f.to) {
    // Ждущие стоят на времени запланированной попытки, остальные — на времени отправки.
    const range: Prisma.DateTimeFilter = {};
    if (f.from) range.gte = mskDay(f.from);
    if (f.to) range.lte = mskDay(f.to, true);
    and.push({
      OR: [
        { status: "queued", nextAttemptAt: range },
        { status: "queued", nextAttemptAt: null, createdAt: range },
        { status: { not: "queued" }, sentAt: range },
        { status: { not: "queued" }, sentAt: null, updatedAt: range },
      ],
    });
  }
  return { AND: and };
}

const journalSelect = {
  id: true,
  campaignId: true,
  userId: true,
  contactId: true,
  email: true,
  name: true,
  companyName: true,
  status: true,
  emailStatus: true,
  emailError: true,
  inAppStatus: true,
  inAppError: true,
  pushStatus: true,
  pushError: true,
  telegramStatus: true,
  telegramError: true,
  waitReason: true,
  attempts: true,
  nextAttemptAt: true,
  sentAt: true,
  updatedAt: true,
  createdAt: true,
  clickCount: true,
  clickedAt: true,
  unsubscribedAt: true,
  dryRun: true,
  campaign: { select: { title: true, status: true } },
} satisfies Prisma.MailingRecipientSelect;

type JournalDbRow = Prisma.MailingRecipientGetPayload<{ select: typeof journalSelect }>;

export type JournalRow = {
  id: string;
  campaignId: string;
  campaignTitle: string;
  kind: "user" | "contact";
  userId: string | null;
  email: string | null;
  name: string | null;
  companyName: string | null;
  status: string;
  statusLabel: string;
  channels: Partial<Record<MailingChannel, { status: ChannelStatus; error: string | null }>>;
  waitReason: string | null;
  waitLabel: string | null;
  attempts: number;
  /** Ждущие — время попытки, остальные — время отправки. */
  eventAt: string;
  clickCount: number;
  unsubscribed: boolean;
  dryRun: boolean;
};

function toJournalRow(r: JournalDbRow, now: Date): JournalRow {
  const channels: JournalRow["channels"] = {};
  for (const c of MAILING_CHANNELS) {
    const status = r[`${c}Status`] as ChannelStatus | null;
    if (status) channels[c] = { status, error: (r[`${c}Error`] as string | null) ?? null };
  }
  const queued = r.status === "queued";
  const eventAt = queued ? new Date(Math.max(now.getTime(), (r.nextAttemptAt ?? now).getTime())) : (r.sentAt ?? r.updatedAt);
  const waiting = queued && (r.waitReason === "global_limit" || (r.nextAttemptAt !== null && r.nextAttemptAt.getTime() > now.getTime()));
  return {
    id: r.id,
    campaignId: r.campaignId,
    campaignTitle: r.campaign.title,
    kind: r.contactId ? "contact" : "user",
    userId: r.userId,
    email: r.email,
    name: r.name,
    companyName: r.companyName,
    status: r.status,
    statusLabel: RECIPIENT_STATUS_LABELS[r.status as keyof typeof RECIPIENT_STATUS_LABELS] ?? r.status,
    channels,
    waitReason: queued ? r.waitReason : null,
    waitLabel: queued ? (waiting ? waitReasonLabel(r.waitReason ?? "retry") : "В очереди — уйдёт в ближайший проход") : null,
    attempts: r.attempts,
    eventAt: eventAt.toISOString(),
    clickCount: r.clickCount,
    unsubscribed: r.unsubscribedAt !== null,
    dryRun: r.dryRun,
  };
}

function journalOrder(f: JournalFilters): Prisma.MailingRecipientOrderByWithRelationInput[] {
  return f.status === "planned" || f.reason
    ? [{ nextAttemptAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }, { id: "asc" }]
    : [{ updatedAt: "desc" }, { id: "desc" }];
}

export type JournalData = {
  rows: JournalRow[];
  count: number;
  page: number;
  pages: number;
  filters: JournalFilters;
  /** Причины ожидания в выборке (по рассылке, без фильтров) — для списка. */
  reasons: Array<{ reason: string; label: string; count: number }>;
  campaigns: Array<{ id: string; title: string; status: string }>;
};

export async function getJournal(filters: JournalFilters, now: Date = new Date()): Promise<JournalData> {
  const where = journalWhere(filters);
  const count = await db.mailingRecipient.count({ where });
  const pages = Math.max(1, Math.ceil(count / JOURNAL_PAGE));
  const page = Math.min(filters.page, pages);
  const scope: Prisma.MailingRecipientWhereInput = filters.campaign
    ? { campaignId: filters.campaign, isTest: false, status: "queued" }
    : { isTest: false, status: "queued", campaign: { status: { in: ["scheduled", "sending", "paused"] } } };
  const [rows, reasonGroups, campaigns] = await Promise.all([
    db.mailingRecipient.findMany({
      where,
      select: journalSelect,
      orderBy: journalOrder(filters),
      skip: (page - 1) * JOURNAL_PAGE,
      take: JOURNAL_PAGE,
    }),
    db.mailingRecipient.groupBy({ by: ["waitReason"], where: scope, _count: { _all: true } }),
    db.mailingCampaign.findMany({
      where: { status: { not: "draft" } },
      select: { id: true, title: true, status: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);
  return {
    rows: rows.map((r) => toJournalRow(r, now)),
    count,
    page,
    pages,
    filters: { ...filters, page },
    reasons: reasonGroups
      .map((g) => ({ reason: g.waitReason ?? "none", label: g.waitReason ? waitReasonLabel(g.waitReason) : "Без причины (ждёт прохода)", count: g._count._all }))
      .sort((a, b) => b.count - a.count),
    campaigns,
  };
}

// ------------------------------------------------------------------ CSV

export const JOURNAL_CSV_MAX = 50_000;

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Формулы Excel не исполняем: «=», «+», «-», «@» в начале — с апострофом.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function mskStamp(iso: string): string {
  return new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
}

/** Полный журнал по фильтрам — CSV для Excel (UTF-8 с BOM, «;»). */
export async function journalCsv(filters: JournalFilters, now: Date = new Date()): Promise<{ csv: string; rows: number; truncated: boolean }> {
  const where = journalWhere(filters);
  const header = [
    "Рассылка",
    "Email",
    "Имя",
    "Компания",
    "Кто",
    "Итог",
    ...MAILING_CHANNELS.map((c) => CHANNEL_LABELS[c]),
    "Ошибки и пропуски",
    "Причина ожидания",
    "Попыток",
    "Когда (МСК)",
    "Переходов",
    "Отписался",
  ];
  const lines = [header.map(csvCell).join(";")];
  let rows = 0;
  let cursor: string | undefined;
  while (rows < JOURNAL_CSV_MAX) {
    const batch = await db.mailingRecipient.findMany({
      where,
      select: journalSelect,
      orderBy: { id: "asc" },
      take: Math.min(2000, JOURNAL_CSV_MAX - rows),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    for (const raw of batch) {
      const r = toJournalRow(raw, now);
      const errors = MAILING_CHANNELS.map((c) => (r.channels[c]?.error ? `${CHANNEL_LABELS[c]}: ${r.channels[c]!.error}` : ""))
        .filter(Boolean)
        .join(" | ");
      lines.push(
        [
          r.campaignTitle,
          r.email ?? "",
          r.name ?? "",
          r.companyName ?? "",
          r.kind === "contact" ? "контакт" : "пользователь",
          r.statusLabel,
          ...MAILING_CHANNELS.map((c) => (r.channels[c] ? CHANNEL_STATUS_LABELS[r.channels[c]!.status] : "")),
          errors,
          r.waitLabel ?? "",
          r.attempts,
          mskStamp(r.eventAt),
          r.clickCount,
          r.unsubscribed ? "да" : "",
        ]
          .map(csvCell)
          .join(";")
      );
      rows += 1;
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < 2000) break;
  }
  const truncated = rows >= JOURNAL_CSV_MAX && (await db.mailingRecipient.count({ where })) > rows;
  return { csv: `\uFEFF${lines.join("\r\n")}\r\n`, rows, truncated };
}

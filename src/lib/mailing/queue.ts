import type { EmailAttachment } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";
import type { OrgSphere } from "@/lib/org-profile";

import {
  CHANNEL_LABELS,
  MAILING_CHANNELS,
  overallRecipientStatus,
  type ChannelStatus,
  type MailingChannel,
  type RecipientStatus,
} from "./labels";
import { createLinkTracker } from "./links";
import { emailBudget, minuteWindowStart, mskDayStart, type MailingSettings } from "./rate-limit";
import {
  getMailingTemplate,
  type MailingRecipientContext,
  type MailingRenderMode,
  type MailingTemplate,
  type RenderedMailing,
} from "./templates";

/**
 * Очередь рассылки — строки `MailingRecipient`.
 *
 * Правила:
 *   • канал получателя отправляется один раз: queued → sending → sent |
 *     failed | skipped. «sending» ставится ДО отправки; если сервер упал
 *     посередине, такой канал на следующем проходе помечается ошибкой и НЕ
 *     повторяется — лучше не дослать, чем прислать рекламу дважды
 *     («Повторить неудачные» в ROOT вернёт его в очередь осознанно);
 *   • временный сбой — до 3 попыток с паузой 1 и 5 минут, постоянный —
 *     сразу ошибка; адрес, который сервер назвал несуществующим, уходит в
 *     стоп-лист («bounced»);
 *   • письмо не уходит на адрес из стоп-листа, пользователю с
 *     `marketingOptOut` и контакту не в статусе «active» — skipped;
 *   • писем не больше лимита в минуту и в сутки (`rate-limit.ts`),
 *     остальные ждут следующего прохода;
 *   • отменённая рассылка не отправляет ничего: канал берётся в работу
 *     условным обновлением «рассылка ещё идёт».
 *
 * Хранилище и отправители подменяются в тестах; боевые — в
 * `store.server.ts` и `channels.server.ts`. Проходы не пересекаются:
 * вызывающий держит advisory-блокировку.
 */

export const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000];

export type QueueCampaign = {
  id: string;
  /** Название для себя — шаблону для подписей (например, заметка промокода). */
  title?: string;
  kind: string;
  payload: unknown;
  status: string;
};

export type QueueRecipient = {
  id: string;
  campaignId: string;
  token: string;
  userId: string | null;
  contactId: string | null;
  email: string | null;
  name: string | null;
  companyName: string | null;
  sphere: string | null;
  organizationId: string | null;
  isTest: boolean;
  emailStatus: ChannelStatus | null;
  inAppStatus: ChannelStatus | null;
  pushStatus: ChannelStatus | null;
  telegramStatus: ChannelStatus | null;
  attempts: number;
  nextAttemptAt: Date | null;
  links: string[];
  payload: Record<string, unknown> | null;
};

export type RecipientPatch = {
  emailStatus?: ChannelStatus | null;
  emailError?: string | null;
  inAppStatus?: ChannelStatus | null;
  inAppError?: string | null;
  pushStatus?: ChannelStatus | null;
  pushError?: string | null;
  telegramStatus?: ChannelStatus | null;
  telegramError?: string | null;
  status?: RecipientStatus;
  attempts?: number;
  nextAttemptAt?: Date | null;
  sentAt?: Date;
  emailSentAt?: Date;
  links?: string[];
  dryRun?: boolean;
};

export interface MailingQueueStore {
  /** Запланированные с наступившим временем → «sending». Вернуть их id. */
  startDueScheduled(now: Date): Promise<string[]>;
  /** Идущие рассылки, по которым ещё не отработал `prepare`. */
  campaignsToPrepare(): Promise<QueueCampaign[]>;
  /** Получатели рассылки (без тестовых), которым есть что отправлять, с тем, что уже подготовлено. */
  prepareRecipients(campaignId: string): Promise<
    Array<{
      id: string;
      email: string | null;
      organizationId: string | null;
      companyName: string | null;
      sphere: string | null;
      payload?: unknown;
    }>
  >;
  savePrepared(campaignId: string, personal: Record<string, Record<string, unknown>>, now: Date): Promise<void>;
  savePrepareError(campaignId: string, error: string): Promise<void>;
  /** Каналы «sending», оставшиеся от упавшего прохода → failed. Вернуть число получателей. */
  failStaleSending(now: Date): Promise<number>;
  /**
   * Получатели идущих (и подготовленных) рассылок в очереди, у которых
   * время пришло. `emailAllowed = false` — только те, у кого в очереди
   * есть не только письмо.
   */
  listDueRecipients(now: Date, limit: number, emailAllowed: boolean): Promise<QueueRecipient[]>;
  getCampaign(id: string): Promise<QueueCampaign | null>;
  countEmailsSentSince(since: Date): Promise<number>;
  suppressedEmails(emails: string[]): Promise<Set<string>>;
  optedOutUsers(userIds: string[]): Promise<Set<string>>;
  contactStatuses(contactIds: string[]): Promise<Map<string, string>>;
  /**
   * queued → sending для этих каналов и сохранить ссылки. Условие — канал
   * ещё в очереди и (кроме теста) рассылка ещё идёт. false — не взяли.
   */
  claimChannels(
    recipientId: string,
    channels: MailingChannel[],
    links: string[],
    options: { requireSending: boolean }
  ): Promise<boolean>;
  saveRecipient(recipientId: string, patch: RecipientPatch): Promise<void>;
  markBounced(email: string, campaignId: string, error: string): Promise<void>;
  markContactSent(contactId: string, at: Date): Promise<void>;
  /** Нет получателей в очереди — рассылка завершена. true — завершили сейчас. */
  finishCampaignIfDone(campaignId: string, now: Date): Promise<boolean>;
  refreshCounters(campaignId: string): Promise<void>;
}

export type SendOutcome =
  | { kind: "sent"; dryRun?: boolean; note?: string }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string; transient: boolean; bounce?: boolean };

export type OutgoingEmail = {
  to: string;
  subject: string;
  preheader?: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  /** Страница отписки (ссылка в письме). */
  unsubscribeUrl: string;
  /** POST one-click (`List-Unsubscribe`). */
  oneClickUrl: string;
  campaignId: string;
  recipientId: string;
  isTest: boolean;
};
export type OutgoingInApp = {
  userId: string;
  organizationId: string | null;
  campaignId: string;
  recipientId: string;
  title: string;
  body: string;
  url: string | null;
  isTest: boolean;
};
export type OutgoingPush = {
  userId: string;
  campaignId: string;
  recipientId: string;
  title: string;
  body: string;
  url: string | null;
};
export type OutgoingTelegram = {
  userId: string;
  organizationId: string | null;
  campaignId: string;
  recipientId: string;
  text: string;
  url: string | null;
};

export interface ChannelSenders {
  email(msg: OutgoingEmail): Promise<SendOutcome>;
  inApp(msg: OutgoingInApp): Promise<SendOutcome>;
  push(msg: OutgoingPush): Promise<SendOutcome>;
  telegram(msg: OutgoingTelegram): Promise<SendOutcome>;
}

export type QueueLog = (level: "info" | "debug" | "error", message: string, data?: Record<string, unknown>) => void;

export type QueueDeps = {
  store: MailingQueueStore;
  senders: ChannelSenders;
  settings: MailingSettings;
  appUrl: string;
  now?: () => Date;
  template?: (kind: string) => MailingTemplate<any> | null;
  batchSize?: number;
  log?: QueueLog;
};

export type QueueReport = {
  startedScheduled: number;
  prepared: number;
  staleFailed: number;
  processed: number;
  sent: Record<MailingChannel, number>;
  failed: number;
  skipped: number;
  retried: number;
  deferredByLimit: number;
  limitedBy: "minute" | "day" | null;
  emailBudget: number;
  finishedCampaigns: string[];
};

const defaultLog: QueueLog = (level, message, data) => {
  const line = `[mailing] ${message}`;
  if (level === "error") console.error(line, data ?? "");
  else if (level === "debug") console.debug(line, data ?? "");
  else console.info(line, data ?? "");
};

const STATUS_FIELD: Record<MailingChannel, keyof RecipientPatch> = {
  email: "emailStatus",
  inApp: "inAppStatus",
  push: "pushStatus",
  telegram: "telegramStatus",
};
const ERROR_FIELD: Record<MailingChannel, keyof RecipientPatch> = {
  email: "emailError",
  inApp: "inAppError",
  push: "pushError",
  telegram: "telegramError",
};

export function channelStatusOf(r: QueueRecipient, channel: MailingChannel): ChannelStatus | null {
  switch (channel) {
    case "email":
      return r.emailStatus;
    case "inApp":
      return r.inAppStatus;
    case "push":
      return r.pushStatus;
    case "telegram":
      return r.telegramStatus;
  }
}

function setChannel(patch: RecipientPatch, channel: MailingChannel, status: ChannelStatus, error: string | null) {
  (patch as Record<string, unknown>)[STATUS_FIELD[channel]] = status;
  (patch as Record<string, unknown>)[ERROR_FIELD[channel]] = error;
}

const SPHERES_ANY = (value: string | null): OrgSphere | null => (value ? (value as OrgSphere) : null);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function unsubscribePageUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/unsubscribe/${encodeURIComponent(token)}`;
}

export function oneClickUnsubscribeUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/api/mailing/unsubscribe/${encodeURIComponent(token)}`;
}

/**
 * Контекст шаблона для получателя; `track: false` — предпросмотр без учёта
 * кликов, `mode` — настоящая отправка, тест себе или предпросмотр.
 */
export function buildRecipientContext(
  r: Pick<
    QueueRecipient,
    "id" | "token" | "email" | "name" | "companyName" | "sphere" | "userId" | "organizationId" | "contactId" | "links" | "payload"
  >,
  appUrl: string,
  options: { track: boolean; mode?: MailingRenderMode } = { track: true }
): { ctx: MailingRecipientContext; links: () => string[] } {
  const tracker = createLinkTracker(appUrl, r.token, r.links);
  const base = appUrl.replace(/\/+$/, "");
  const ctx: MailingRecipientContext = {
    mode: options.mode ?? "live",
    recipientId: r.id,
    email: r.email,
    name: r.name,
    companyName: r.companyName,
    sphere: SPHERES_ANY(r.sphere),
    userId: r.userId,
    organizationId: r.organizationId,
    contactId: r.contactId,
    unsubscribeUrl: unsubscribePageUrl(appUrl, r.token),
    trackUrl: options.track
      ? tracker.track
      : (url: string) => (url.trim().startsWith("/") ? `${base}${url.trim()}` : url.trim()),
    personal: r.payload ?? {},
  };
  return { ctx, links: () => tracker.links };
}

/**
 * Тест себе: пометки шаблона («промокод — пример…») — плашкой вверху
 * письма, первой строкой текстовой версии и строкой в Telegram. Чтобы
 * тестовое письмо, пересланное коллеге, не выдавало пример за настоящее.
 */
export function withTestNotes(rendered: RenderedMailing): RenderedMailing {
  const notes = (rendered.notes ?? []).map((n) => n.trim()).filter(Boolean);
  if (notes.length === 0) return rendered;
  const line = `Тестовое письмо. ${notes.join(" ")}`;
  const out: RenderedMailing = { ...rendered };
  if (rendered.email) {
    const banner =
      `<div data-mailing-test-note style="margin:0;padding:10px 16px;background:#fff8eb;color:#7a4a00;` +
      `font-family:Arial,sans-serif;font-size:13px;line-height:1.5;text-align:center">${escapeHtml(line)}</div>`;
    const html = /<body[^>]*>/i.test(rendered.email.html)
      ? rendered.email.html.replace(/<body[^>]*>/i, (tag) => `${tag}${banner}`)
      : `${banner}${rendered.email.html}`;
    out.email = { ...rendered.email, html, text: `${line}\n\n${rendered.email.text}` };
  }
  if (rendered.telegram) {
    out.telegram = { ...rendered.telegram, text: `${rendered.telegram.text}\n\n<i>${escapeHtml(line)}</i>` };
  }
  return out;
}

/**
 * Страховка для любых типов: в письме обязана быть ссылка «Отписаться».
 * Если шаблон её не поставил — добавляем в конец.
 */
export function ensureUnsubscribe(
  email: NonNullable<RenderedMailing["email"]>,
  unsubscribeUrl: string
): NonNullable<RenderedMailing["email"]> {
  const safeUrl = unsubscribeUrl.replace(/&/g, "&amp;");
  let html = email.html;
  if (!html.includes(unsubscribeUrl) && !html.includes(safeUrl)) {
    const footer = `<p style="margin:16px 0;font-size:12px;color:#a1a1aa;text-align:center"><a href="${safeUrl}" style="color:#a1a1aa">Отписаться от новостей и предложений</a></p>`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${footer}</body>`) : `${html}${footer}`;
  }
  const text = email.text.includes(unsubscribeUrl)
    ? email.text
    : `${email.text}\n\n—\nОтписаться от новостей и предложений: ${unsubscribeUrl}`;
  return { ...email, html, text };
}

type EmailGate = { suppressed: Set<string>; optedOut: Set<string>; contactStatus: Map<string, string> };

/** Почему письмо этому получателю не отправляем; null — можно. */
export function emailSkipReason(r: QueueRecipient, gate: EmailGate): string | null {
  if (!r.email) return "Нет адреса почты";
  if (gate.suppressed.has(r.email.toLowerCase())) return "Адрес в стоп-листе";
  if (r.userId && gate.optedOut.has(r.userId)) return "Отписался от новостей и предложений";
  if (r.contactId) {
    const status = gate.contactStatus.get(r.contactId);
    if (status && status !== "active") {
      return status === "unsubscribed"
        ? "Контакт отписался"
        : status === "bounced"
          ? "Адрес не принимает почту"
          : status === "complained"
            ? "Контакт пожаловался на спам"
            : `Контакт: ${status}`;
    }
  }
  return null;
}

function retryDelay(attempts: number): number {
  return RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[0];
}

export type DeliverOptions = {
  /** Тестовая отправка: без стоп-листа, лимита и проверки статуса рассылки. */
  test: boolean;
  /** Сколько писем ещё можно отправить в этом проходе (изменяется). */
  emailBudget: { remaining: number };
  gate: EmailGate;
};

export type DeliverResult = {
  status: RecipientStatus;
  channels: Partial<Record<MailingChannel, { status: ChannelStatus; error: string | null; dryRun?: boolean }>>;
  deferredEmail: boolean;
  retried: boolean;
  claimed: boolean;
  /** Пометки шаблона для ROOT (только в тесте себе). */
  notes?: string[];
};

/**
 * Доставить получателю всё, что у него в очереди. Общая часть очереди и
 * «Тестовой отправки мне».
 */
export async function deliverRecipient(
  r: QueueRecipient,
  campaign: QueueCampaign,
  deps: QueueDeps,
  options: DeliverOptions
): Promise<DeliverResult> {
  const { store } = deps;
  const log = deps.log ?? defaultLog;
  const now = (deps.now ?? (() => new Date()))();
  const patch: RecipientPatch = {};
  const result: DeliverResult = { status: "queued", channels: {}, deferredEmail: false, retried: false, claimed: false };
  const statuses: Record<MailingChannel, ChannelStatus | null> = {
    email: r.emailStatus,
    inApp: r.inAppStatus,
    push: r.pushStatus,
    telegram: r.telegramStatus,
  };
  const note = (channel: MailingChannel, status: ChannelStatus, error: string | null, dryRun?: boolean) => {
    statuses[channel] = status;
    setChannel(patch, channel, status, error);
    result.channels[channel] = { status, error, ...(dryRun ? { dryRun } : {}) };
  };

  const attempt: MailingChannel[] = [];
  for (const channel of MAILING_CHANNELS) {
    if (statuses[channel] !== "queued") continue;
    if (channel === "email") {
      const reason = options.test ? (r.email ? null : "Нет адреса почты") : emailSkipReason(r, options.gate);
      if (reason) {
        note("email", "skipped", reason);
        continue;
      }
      if (!options.test && options.emailBudget.remaining <= 0) {
        result.deferredEmail = true;
        continue;
      }
      if (!options.test) options.emailBudget.remaining -= 1;
      attempt.push("email");
      continue;
    }
    if (!r.userId) {
      note(channel, "skipped", "Канал только для пользователей платформы");
      continue;
    }
    attempt.push(channel);
  }

  if (attempt.length === 0) {
    if (Object.keys(patch).length > 0) {
      patch.status = overallRecipientStatus(Object.values(statuses));
      await store.saveRecipient(r.id, patch);
    }
    result.status = overallRecipientStatus(Object.values(statuses));
    return result;
  }

  const template = (deps.template ?? getMailingTemplate)(campaign.kind);
  const { ctx, links } = buildRecipientContext(r, deps.appUrl, { track: true, mode: options.test ? "test" : "live" });
  let rendered: RenderedMailing | null = null;
  let renderError: string | null = null;
  if (!template) {
    renderError = `Тип рассылки «${campaign.kind}» не найден`;
  } else {
    try {
      rendered = await template.render(campaign.payload, ctx);
    } catch (error) {
      renderError = `Ошибка шаблона: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300);
    }
  }
  if (rendered && options.test && rendered.notes && rendered.notes.length > 0) {
    rendered = withTestNotes(rendered);
    result.notes = rendered.notes;
    log("info", `campaign=${campaign.id} test send with template notes`, { notes: rendered.notes });
  }

  const claimed = await store.claimChannels(r.id, attempt, links(), { requireSending: !options.test });
  result.claimed = claimed;
  if (!claimed) {
    // Рассылку отменили или канал уже взят — ничего не отправляем, место
    // в лимите писем возвращаем.
    if (!options.test && attempt.includes("email")) options.emailBudget.remaining += 1;
    log("debug", `campaign=${campaign.id} recipient=${r.id} not claimed (cancelled or taken)`);
    result.status = r.isTest ? "queued" : "cancelled";
    return result;
  }
  if (links().length > 0) patch.links = links();

  let transientFailure = false;
  let anySent = false;
  let dryRun = false;
  for (const channel of attempt) {
    let outcome: SendOutcome;
    if (renderError || !rendered) {
      outcome = { kind: "failed", error: renderError ?? "Шаблон ничего не вернул", transient: false };
    } else {
      outcome = await sendChannel(channel, rendered, r, campaign, ctx.unsubscribeUrl, deps, options.test);
    }
    if (outcome.kind === "sent") {
      anySent = true;
      if (outcome.dryRun) dryRun = true;
      // У сухой отправки пометка лишняя — это видно по значку «сухая».
      note(channel, "sent", outcome.dryRun ? null : (outcome.note ?? null), outcome.dryRun);
      if (channel === "email") {
        patch.emailSentAt = now;
        if (r.contactId) await store.markContactSent(r.contactId, now);
      }
      log("debug", `campaign=${campaign.id} recipient=${r.id} ${channel}=sent${outcome.dryRun ? " (dry-run)" : ""}`);
      continue;
    }
    if (outcome.kind === "skipped") {
      note(channel, "skipped", outcome.reason);
      log("debug", `campaign=${campaign.id} recipient=${r.id} ${channel}=skipped: ${outcome.reason}`);
      continue;
    }
    const canRetry = outcome.transient && !options.test && r.attempts + 1 < MAX_ATTEMPTS;
    if (canRetry) {
      transientFailure = true;
      note(channel, "queued", `Попытка ${r.attempts + 1}: ${outcome.error}`.slice(0, 500));
    } else {
      note(channel, "failed", outcome.error.slice(0, 500));
      if (channel === "email" && outcome.bounce && r.email) {
        await store.markBounced(r.email, campaign.id, outcome.error);
      }
    }
    log("error", `campaign=${campaign.id} recipient=${r.id} ${CHANNEL_LABELS[channel]}: ${outcome.error}`, {
      transient: outcome.transient,
      attempt: r.attempts + 1,
      willRetry: canRetry,
    });
  }

  if (transientFailure) {
    patch.attempts = r.attempts + 1;
    patch.nextAttemptAt = new Date(now.getTime() + retryDelay(r.attempts + 1));
    result.retried = true;
  } else if (r.nextAttemptAt) {
    patch.nextAttemptAt = null;
  }
  if (anySent) patch.sentAt = now;
  if (dryRun) patch.dryRun = true;
  patch.status = overallRecipientStatus(Object.values(statuses));
  result.status = patch.status;
  await store.saveRecipient(r.id, patch);
  return result;
}

async function sendChannel(
  channel: MailingChannel,
  rendered: RenderedMailing,
  r: QueueRecipient,
  campaign: QueueCampaign,
  unsubscribeUrl: string,
  deps: QueueDeps,
  isTest: boolean
): Promise<SendOutcome> {
  const { senders } = deps;
  try {
    if (channel === "email") {
      if (!rendered.email) return { kind: "skipped", reason: "Этот тип не отправляет письма" };
      const email = ensureUnsubscribe(rendered.email, unsubscribeUrl);
      return await senders.email({
        to: r.email as string,
        subject: email.subject,
        preheader: email.preheader,
        html: email.html,
        text: email.text,
        attachments: email.attachments,
        unsubscribeUrl,
        oneClickUrl: oneClickUnsubscribeUrl(deps.appUrl, r.token),
        campaignId: campaign.id,
        recipientId: r.id,
        isTest,
      });
    }
    if (channel === "inApp") {
      if (!rendered.inApp) return { kind: "skipped", reason: "Этот тип не пишет в колокольчик" };
      return await senders.inApp({
        userId: r.userId as string,
        organizationId: r.organizationId,
        campaignId: campaign.id,
        recipientId: r.id,
        title: rendered.inApp.title,
        body: rendered.inApp.body,
        url: rendered.inApp.url ?? null,
        isTest,
      });
    }
    if (channel === "push") {
      if (!rendered.push) return { kind: "skipped", reason: "Этот тип не отправляет push" };
      return await senders.push({
        userId: r.userId as string,
        campaignId: campaign.id,
        recipientId: r.id,
        title: rendered.push.title,
        body: rendered.push.body,
        url: rendered.push.url ?? null,
      });
    }
    if (!rendered.telegram) return { kind: "skipped", reason: "Этот тип не отправляет в Telegram" };
    return await senders.telegram({
      userId: r.userId as string,
      organizationId: r.organizationId,
      campaignId: campaign.id,
      recipientId: r.id,
      text: rendered.telegram.text,
      url: rendered.telegram.url ?? null,
    });
  } catch (error) {
    // Отправитель не должен бросать; если бросил — считаем временным сбоем.
    return {
      kind: "failed",
      error: error instanceof Error ? error.message : String(error),
      transient: true,
    };
  }
}

function emptyReport(): QueueReport {
  return {
    startedScheduled: 0,
    prepared: 0,
    staleFailed: 0,
    processed: 0,
    sent: { email: 0, inApp: 0, push: 0, telegram: 0 },
    failed: 0,
    skipped: 0,
    retried: 0,
    deferredByLimit: 0,
    limitedBy: null,
    emailBudget: 0,
    finishedCampaigns: [],
  };
}

/** Один проход очереди (cron раз в минуту и толчок после запуска). */
export async function runQueuePass(deps: QueueDeps): Promise<QueueReport> {
  const { store } = deps;
  const log = deps.log ?? defaultLog;
  const now = (deps.now ?? (() => new Date()))();
  const report = emptyReport();
  const touched = new Set<string>();

  const started = await store.startDueScheduled(now);
  report.startedScheduled = started.length;
  for (const id of started) {
    touched.add(id);
    log("info", `campaign=${id} status scheduled → sending`);
  }

  for (const campaign of await store.campaignsToPrepare()) {
    const template = (deps.template ?? getMailingTemplate)(campaign.kind);
    try {
      let personal: Record<string, Record<string, unknown>> = {};
      if (template?.prepare) {
        const recipients = await store.prepareRecipients(campaign.id);
        personal = await template.prepare(
          { id: campaign.id, title: campaign.title ?? "", payload: campaign.payload },
          recipients.map(({ payload, ...x }) => ({ ...x, sphere: SPHERES_ANY(x.sphere), personal: asRecord(payload) }))
        );
      }
      await store.savePrepared(campaign.id, personal, now);
      report.prepared += 1;
      log("info", `campaign=${campaign.id} prepared`, { personal: Object.keys(personal).length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.savePrepareError(campaign.id, message.slice(0, 500));
      log("error", `campaign=${campaign.id} prepare failed — повторим на следующем проходе`, { error: message });
    }
  }

  report.staleFailed = await store.failStaleSending(now);
  if (report.staleFailed > 0) {
    log("error", `stale «sending» channels → failed (сервер прерывался)`, { recipients: report.staleFailed });
  }

  const [sentLastMinute, sentToday] = await Promise.all([
    store.countEmailsSentSince(minuteWindowStart(now)),
    store.countEmailsSentSince(mskDayStart(now)),
  ]);
  const budget = emailBudget(deps.settings, sentLastMinute, sentToday);
  report.emailBudget = budget.budget;
  report.limitedBy = budget.limitedBy;
  const emailBudgetRef = { remaining: budget.budget };

  const due = await store.listDueRecipients(now, deps.batchSize ?? 200, budget.budget > 0);
  if (due.length === 0) {
    for (const id of touched) await finishIfDone(id, deps, report, now, log);
    return report;
  }

  const emails = [...new Set(due.map((r) => r.email?.toLowerCase()).filter((e): e is string => Boolean(e)))];
  const userIds = [...new Set(due.map((r) => r.userId).filter((id): id is string => Boolean(id)))];
  const contactIds = [...new Set(due.map((r) => r.contactId).filter((id): id is string => Boolean(id)))];
  const [suppressed, optedOut, contactStatus] = await Promise.all([
    store.suppressedEmails(emails),
    store.optedOutUsers(userIds),
    store.contactStatuses(contactIds),
  ]);
  const gate = { suppressed, optedOut, contactStatus };

  const campaigns = new Map<string, QueueCampaign | null>();
  for (const r of due) {
    if (!campaigns.has(r.campaignId)) campaigns.set(r.campaignId, await store.getCampaign(r.campaignId));
    const campaign = campaigns.get(r.campaignId);
    if (!campaign || campaign.status !== "sending") continue;
    touched.add(campaign.id);
    const result = await deliverRecipient(r, campaign, deps, { test: false, emailBudget: emailBudgetRef, gate });
    report.processed += 1;
    if (result.deferredEmail) report.deferredByLimit += 1;
    if (result.retried) report.retried += 1;
    for (const channel of MAILING_CHANNELS) {
      const c = result.channels[channel];
      if (!c) continue;
      if (c.status === "sent") report.sent[channel] += 1;
      else if (c.status === "failed") report.failed += 1;
      else if (c.status === "skipped") report.skipped += 1;
    }
  }
  // Лимит кончился посреди прохода: остальные письма ждут.
  if (report.deferredByLimit > 0 && report.limitedBy === null) {
    const used = budget.budget - emailBudgetRef.remaining;
    report.limitedBy = sentToday + used >= deps.settings.perDay ? "day" : "minute";
  }

  for (const id of touched) await finishIfDone(id, deps, report, now, log);
  log("info", "pass done", {
    processed: report.processed,
    sent: report.sent,
    failed: report.failed,
    skipped: report.skipped,
    retried: report.retried,
    deferredByLimit: report.deferredByLimit,
    limitedBy: report.limitedBy,
    emailBudget: report.emailBudget,
  });
  return report;
}

async function finishIfDone(id: string, deps: QueueDeps, report: QueueReport, now: Date, log: QueueLog) {
  const finished = await deps.store.finishCampaignIfDone(id, now);
  await deps.store.refreshCounters(id);
  if (finished) {
    report.finishedCampaigns.push(id);
    log("info", `campaign=${id} status sending → done`);
  }
}

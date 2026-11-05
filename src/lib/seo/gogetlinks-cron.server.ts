import { db } from "@/lib/db";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";
import { isPlatformAdministrator } from "@/lib/platform-access";
import {
  getPlatformAdminEmails,
  getPlatformAdminRecipientChatIds,
  notifyPlatformAdmin,
} from "@/lib/platform-admin";
import { adminNotificationEmail, mergeAdminEmails } from "@/lib/platform-admin-mail";
import {
  materializePlanSlots,
  prepareUpcomingPlannedSlots,
  recycleRejectedSlotOrders,
} from "@/lib/seo/gogetlinks-orders.server";
import { type GglSyncSummary, syncGglCabinet } from "@/lib/seo/gogetlinks-sync.server";
import { sendTelegramMessage } from "@/lib/telegram";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const DELIVERED_LOG_STATUSES = ["queued", "sent", "rate_limited", "deferred"];

let activeCronRun = false;
let defaultDepsOverride: GglCronDeps | null = null;

export interface PendingSlotsSummary {
  dueTodayCount: number;
  next7DaysSumRub: number;
  dateKey: string;
}

export interface GglCronAlertOptions {
  kind?: string;
  dedupeKey?: string;
  email?: boolean;
}

export interface GglCronDeps {
  now?: Date;
  hasConfiguredAccount?: () => Promise<boolean>;
  syncCabinet?: () => Promise<GglSyncSummary>;
  recycleRejected?: () => Promise<{
    recycledSlotIds: string[];
    exhaustedSlotIds?: string[];
  }>;
  materializeSlots?: (now: Date) => Promise<{ created: number }>;
  prepareSlots?: (now: Date) => Promise<{ prepared: number; skipped: number }>;
  getPendingSlotsSummary?: (now: Date) => Promise<PendingSlotsSummary>;
  wasAlertSentRecently?: (kind: string, dedupeKey: string, now: Date) => Promise<boolean>;
  notifyAdmins?: (text: string, opts?: GglCronAlertOptions) => Promise<boolean>;
  notifyDelegatedSeoUsers?: (text: string, opts?: GglCronAlertOptions) => Promise<boolean>;
}

export interface GglCronResult {
  skipped: boolean;
  reason?: string;
  synced?: boolean;
  operationalAlertsSent: number;
  lowBalanceAlertSent: boolean;
}

export function setGglCronDefaultDepsForTests(deps: GglCronDeps | null): void {
  defaultDepsOverride = deps;
}

function formatRub(amount: number): string {
  const rounded = Math.round(Number.isFinite(amount) ? amount : 0);
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function toUtcMidnightMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function formatUtcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function resolveLinksAdminUrl(): string {
  const base = (process.env.NEXTAUTH_URL ?? "https://wesetup.ru").trim().replace(/\/+$/, "");
  return `${base}/root/seo/links`;
}

/**
 * Checks `TelegramLog` over a rolling 24-hour window so recurring GoGetLinks alerts
 * (low wallet balance and due-today `pending_approval` slots) do not spam every 10 minutes.
 * Matches bare `kind`, `admin:<kind>`, and `seo:<kind>`. Failed deliveries are not treated
 * as sent so the next cron tick can retry.
 */
export async function wasGglAlertSentRecently(
  kind: string,
  dedupeKey: string,
  now: Date = new Date(),
  prismaClient: { telegramLog: Pick<typeof db.telegramLog, "findFirst"> } = db,
): Promise<boolean> {
  const recent = await prismaClient.telegramLog.findFirst({
    where: {
      kind: { in: [kind, `admin:${kind}`, `seo:${kind}`] },
      dedupeKey,
      status: { in: DELIVERED_LOG_STATUSES },
      createdAt: { gte: new Date(now.getTime() - TWENTY_FOUR_HOURS_MS) },
    },
    select: { id: true },
  });
  return Boolean(recent);
}

/**
 * Sends an operational SEO alert to active, non-archived users who have `"seo"` in
 * `platformSections`, strictly excluding platform superadmins (`isRoot === true`),
 * full-section `"admin"` preset users (`isPlatformAdministrator`), and any Telegram chat
 * or email already covered by `notifyPlatformAdmin` so nobody gets double-notified.
 */
export async function notifyDelegatedSeoSpecialists(
  text: string,
  opts?: GglCronAlertOptions,
  deps?: {
    prismaClient?: { user: Pick<typeof db.user, "findMany"> };
    getAdminChatIds?: () => Promise<string[]>;
    getAdminEmails?: () => Promise<string[]>;
    sendTelegram?: (
      chatId: string,
      body: string,
      sendOpts?: { userId?: string | null; delivery?: { kind?: string; dedupeKey?: string } },
    ) => Promise<boolean>;
    sendEmail?: (to: string, subject: string, html: string) => Promise<boolean>;
  },
): Promise<boolean> {
  const client = deps?.prismaClient ?? db;
  const getAdminChatIds = deps?.getAdminChatIds ?? getPlatformAdminRecipientChatIds;
  const getAdminEmails = deps?.getAdminEmails ?? getPlatformAdminEmails;
  const sendTelegram =
    deps?.sendTelegram ??
    ((chatId, body, sendOpts) =>
      sendTelegramMessage(chatId, body, {
        userId: sendOpts?.userId ?? null,
        delivery: sendOpts?.delivery,
      }));
  const sendEmail = deps?.sendEmail ?? ((to, subject, html) => sendRawEmail(to, subject, html));

  const rows = await client.user.findMany({
    where: {
      isActive: true,
      archivedAt: null,
      isRoot: false,
      platformSections: { has: "seo" },
    },
    select: {
      id: true,
      email: true,
      contactEmail: true,
      telegramChatId: true,
      isRoot: true,
      platformSections: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const delegatedUsers = rows.filter(
    (row) =>
      !row.isRoot &&
      row.platformSections.includes("seo") &&
      !isPlatformAdministrator(row),
  );

  if (delegatedUsers.length === 0) {
    return false;
  }

  const [adminChatIds, adminEmails] = await Promise.all([
    getAdminChatIds().catch(() => [] as string[]),
    getAdminEmails().catch(() => [] as string[]),
  ]);

  const adminChatSet = new Set(adminChatIds.map((id) => id.trim()).filter(Boolean));
  const seenChatIds = new Set<string>();
  const telegramTargets: Array<{ userId: string; chatId: string }> = [];

  for (const user of delegatedUsers) {
    const chatId = user.telegramChatId?.trim();
    if (!chatId || adminChatSet.has(chatId) || seenChatIds.has(chatId)) continue;
    seenChatIds.add(chatId);
    telegramTargets.push({ userId: user.id, chatId });
  }

  const seoKind = opts?.kind ? `seo:${opts.kind}` : "seo";
  const telegramResultsPromise = Promise.all(
    telegramTargets.map(async (target) => {
      try {
        return await sendTelegram(target.chatId, text, {
          userId: target.userId,
          delivery: { kind: seoKind, dedupeKey: opts?.dedupeKey },
        });
      } catch (error) {
        console.error("[gogetlinks-cron] delegated SEO telegram send failed:", error);
        return false;
      }
    }),
  );

  let emailResultsPromise: Promise<boolean[]> = Promise.resolve([]);
  if (opts?.email !== false) {
    const adminEmailSet = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
    const seoEmails = mergeAdminEmails([
      delegatedUsers.map((u) => u.contactEmail?.trim() || u.email),
    ]).filter((email) => !adminEmailSet.has(email.toLowerCase()));

    if (seoEmails.length > 0) {
      const mail = adminNotificationEmail(text);
      const html = renderEmailLayout(
        escapeHtml(mail.title),
        mail.bodyHtml
          ? `<div style="color:#3f3f46;font-size:14px;line-height:1.6">${mail.bodyHtml}</div>`
          : "",
        null,
        {
          preheader: mail.title,
          footerHtml: `<p style="margin:6px 0 0;font-size:12px;color:#a1a1aa;text-align:center">Операционное уведомление SEO-раздела платформы WeSetup.</p>`,
        },
      );
      emailResultsPromise = Promise.all(
        seoEmails.map(async (to) => {
          try {
            return await sendEmail(to, mail.subject, html);
          } catch (error) {
            console.error("[gogetlinks-cron] delegated SEO email send failed:", error);
            return false;
          }
        }),
      );
    }
  }

  const [telegramResults, emailResults] = await Promise.all([
    telegramResultsPromise,
    emailResultsPromise,
  ]);

  return telegramResults.some(Boolean) || emailResults.some(Boolean);
}

async function defaultHasConfiguredAccount(): Promise<boolean> {
  const account = await db.gglAccount.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, passwordEnc: true },
  });
  return Boolean(account && account.email.trim() && account.passwordEnc.trim());
}

async function defaultGetPendingSlotsSummary(now: Date): Promise<PendingSlotsSummary> {
  const todayMs = toUtcMidnightMs(now);
  const dateKey = formatUtcDateKey(todayMs);
  const next7EndKey = formatUtcDateKey(todayMs + 7 * 86_400_000);

  const slots = await db.gglPlannedSlot.findMany({
    where: {
      status: "pending_approval",
      scheduledDate: { lte: next7EndKey },
      plan: {
        isActive: true,
        campaign: { isWesetup: true },
      },
    },
    select: {
      scheduledDate: true,
      estimatedPriceRub: true,
      maxPriceRub: true,
    },
  });

  let dueTodayCount = 0;
  let next7DaysSumRub = 0;
  for (const slot of slots) {
    if (slot.scheduledDate <= dateKey) {
      dueTodayCount += 1;
    }
    next7DaysSumRub += slot.estimatedPriceRub ?? slot.maxPriceRub;
  }

  return { dueTodayCount, next7DaysSumRub, dateKey };
}

function buildOperationalAlertMessage(args: {
  unreadCount: number;
  onCheckCount: number;
  replacementCount: number;
  recycledCount: number;
  exhaustedCount: number;
  dueTodayCount: number;
}): string {
  const lines: string[] = ["<b>GoGetLinks · Новые задачи по ссылкам wesetup.ru</b>"];

  if (args.unreadCount > 0) {
    lines.push(`• Непрочитанных диалогов с вебмастерами: <b>${args.unreadCount}</b>`);
  }
  if (args.onCheckCount > 0) {
    lines.push(`• Размещений на проверке (on_check): <b>${args.onCheckCount}</b>`);
  }
  if (args.replacementCount > 0) {
    lines.push(`• Заявок «На замену» (wesetup.ru): <b>${args.replacementCount}</b>`);
  }
  if (args.recycledCount > 0) {
    lines.push(
      `• Отклонённых слотов переведено на резервного донора: <b>${args.recycledCount}</b>`,
    );
  }
  if (args.exhaustedCount > 0) {
    lines.push(
      `• Отклонённых слотов без резервных доноров (бюджет освобождён): <b>${args.exhaustedCount}</b>`,
    );
  }
  if (args.dueTodayCount > 0) {
    lines.push(
      `• Подготовленных слотов плана к подтверждению сегодня: <b>${args.dueTodayCount}</b>`,
    );
  }

  lines.push(`Откройте раздел <a href="${escapeHtml(resolveLinksAdminUrl())}">/root/seo/links</a>.`);
  return lines.join("\n");
}

function buildLowBalanceAlertMessage(availableRub: number, next7DaysSumRub: number): string {
  const deficitRub = Math.max(0, Math.round(next7DaysSumRub - availableRub));
  return [
    "<b>GoGetLinks · Требуется пополнить баланс</b>",
    `На кошельке доступно <b>${formatRub(availableRub)} ₽</b>, а на подготовленные слоты ближайших 7 дней требуется <b>${formatRub(next7DaysSumRub)} ₽</b> (не хватает ${formatRub(deficitRub)} ₽).`,
    `Пожалуйста, пополните баланс в кабинете GoGetLinks и проверьте план в <a href="${escapeHtml(resolveLinksAdminUrl())}">/root/seo/links</a>.`,
  ].join("\n");
}

/**
 * Executes a single 10-minute GoGetLinks background pass:
 *   1. Overlap guard (`already_running`) + account presence check (`no_account`).
 *   2. Sequential `syncGglCabinet()` -> `recycleRejectedSlotOrders()` ->
 *      `materializePlanSlots()` -> `prepareUpcomingPlannedSlots()`.
 *      SAFETY INVARIANT: Never approves slots or spends money.
 *   3. Tiered fire-and-forget notifications with 24h `TelegramLog` deduplication:
 *      - Operational alerts -> `notifyPlatformAdmin` + delegated `"seo"` users.
 *      - Financial low-balance alert -> `notifyPlatformAdmin` ONLY.
 */
export async function runGglCronPass(deps?: GglCronDeps): Promise<GglCronResult> {
  if (activeCronRun) {
    return {
      skipped: true,
      reason: "already_running",
      operationalAlertsSent: 0,
      lowBalanceAlertSent: false,
    };
  }

  activeCronRun = true;
  try {
    const resolved = deps ?? defaultDepsOverride ?? undefined;
    const now = resolved?.now ?? new Date();

    const hasConfiguredAccount = resolved?.hasConfiguredAccount ?? defaultHasConfiguredAccount;
    if (!(await hasConfiguredAccount())) {
      return {
        skipped: true,
        reason: "no_account",
        operationalAlertsSent: 0,
        lowBalanceAlertSent: false,
      };
    }

    const syncCabinet = resolved?.syncCabinet ?? (() => syncGglCabinet({ now }));
    const recycleRejected = resolved?.recycleRejected ?? (() => recycleRejectedSlotOrders());
    const materializeSlots = resolved?.materializeSlots ?? ((runNow) => materializePlanSlots(runNow));
    const prepareSlots =
      resolved?.prepareSlots ?? ((runNow) => prepareUpcomingPlannedSlots(runNow, 7));
    const getPendingSlotsSummary =
      resolved?.getPendingSlotsSummary ?? defaultGetPendingSlotsSummary;
    const wasAlertSentRecently =
      resolved?.wasAlertSentRecently ??
      ((kind, dedupeKey, checkNow) => wasGglAlertSentRecently(kind, dedupeKey, checkNow));
    const notifyAdmins =
      resolved?.notifyAdmins ?? ((text, opts) => notifyPlatformAdmin(text, opts));
    const notifyDelegatedSeoUsers =
      resolved?.notifyDelegatedSeoUsers ??
      ((text, opts) => notifyDelegatedSeoSpecialists(text, opts));

    // Step 1-4: Strict sequential pipeline, zero automated spend
    const syncSummary = await syncCabinet();
    const recycled = await recycleRejected();
    await materializeSlots(now);
    await prepareSlots(now);

    // Step 5: Evaluate operational & financial alerts (fire-and-forget safe)
    let operationalAlertsSent = 0;
    let lowBalanceAlertSent = false;

    const safeCheckRecent = async (kind: string, dedupeKey: string): Promise<boolean> => {
      try {
        return await wasAlertSentRecently(kind, dedupeKey, now);
      } catch (error) {
        console.error("[gogetlinks-cron] failed checking recent TelegramLog alert:", error);
        return false;
      }
    };

    const pendingSummary = await getPendingSlotsSummary(now).catch((error: unknown) => {
      console.error("[gogetlinks-cron] failed loading pending slots summary:", error);
      return {
        dueTodayCount: 0,
        next7DaysSumRub: 0,
        dateKey: formatUtcDateKey(toUtcMidnightMs(now)),
      };
    });

    const dueSlotsDedupeKey = `due-slots:${pendingSummary.dateKey}`;
    const includeDueToday =
      pendingSummary.dueTodayCount > 0 &&
      !(await safeCheckRecent("ggl-due-slots", dueSlotsDedupeKey));

    const unreadCount = syncSummary.newUnreadThreadIds.length;
    const onCheckCount = syncSummary.newOnCheckOrderIds.length;
    const replacementCount = syncSummary.newReplacementOrderIds.length;
    const recycledCount = recycled.recycledSlotIds.length;
    const exhaustedCount = recycled.exhaustedSlotIds?.length ?? 0;

    const hasOperationalEvents =
      unreadCount > 0 ||
      onCheckCount > 0 ||
      replacementCount > 0 ||
      recycledCount > 0 ||
      exhaustedCount > 0 ||
      includeDueToday;

    if (hasOperationalEvents) {
      const opKind = includeDueToday ? "ggl-due-slots" : "ggl-operational";
      const opDedupeKey = includeDueToday
        ? dueSlotsDedupeKey
        : `ops:${syncSummary.syncedAt}:u${unreadCount}:c${onCheckCount}:r${replacementCount}:f${recycledCount}:x${exhaustedCount}`;
      const opText = buildOperationalAlertMessage({
        unreadCount,
        onCheckCount,
        replacementCount,
        recycledCount,
        exhaustedCount,
        dueTodayCount: includeDueToday ? pendingSummary.dueTodayCount : 0,
      });

      const [adminOpOk, seoOpOk] = await Promise.all([
        notifyAdmins(opText, { kind: opKind, dedupeKey: opDedupeKey }).catch((error: unknown) => {
          console.error("[gogetlinks-cron] admin operational alert failed:", error);
          return false;
        }),
        notifyDelegatedSeoUsers(opText, { kind: opKind, dedupeKey: opDedupeKey }).catch(
          (error: unknown) => {
            console.error("[gogetlinks-cron] delegated SEO operational alert failed:", error);
            return false;
          },
        ),
      ]);

      if (adminOpOk || seoOpOk) {
        operationalAlertsSent += 1;
      }
    }

    if (pendingSummary.next7DaysSumRub > syncSummary.availableRub) {
      const lowBalanceDedupeKey = "low-balance";
      const alreadyWarned = await safeCheckRecent("ggl-low-balance", lowBalanceDedupeKey);
      if (!alreadyWarned) {
        const lowBalanceText = buildLowBalanceAlertMessage(
          syncSummary.availableRub,
          pendingSummary.next7DaysSumRub,
        );
        lowBalanceAlertSent = await notifyAdmins(lowBalanceText, {
          kind: "ggl-low-balance",
          dedupeKey: lowBalanceDedupeKey,
        }).catch((error: unknown) => {
          console.error("[gogetlinks-cron] admin low-balance alert failed:", error);
          return false;
        });
      }
    }

    return {
      skipped: false,
      synced: true,
      operationalAlertsSent,
      lowBalanceAlertSent,
    };
  } finally {
    activeCronRun = false;
  }
}

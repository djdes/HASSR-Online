import { randomUUID } from "node:crypto";

import { withAdvisoryTryLock } from "@/lib/advisory-lock";
import { enqueueAndWait } from "@/lib/ai-assistant/pf-client";
import { db } from "@/lib/db";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";

import { telegramBotConfigured } from "../channels.server";
import { mailingDryRunDir, writeDryRunFile } from "../transport.server";
import { AI_DIGEST_CHANNELS, normalizeAiDigestConfig, type AiDigestChannel, type AiDigestConfig } from "./config";
import { collectDigestMetrics } from "./metrics.server";
import {
  buildAiDigestPrompt,
  fallbackNarrative,
  parseAiDigestReply,
  renderDigest,
  type AiDigestNarrative,
  type DigestMetrics,
  type RenderedDigest,
} from "./report";
import { dueSlot, reportPeriod, slotKey } from "./schedule";

/**
 * ИИ-сводка администратору платформы — автокампания раздела «Рассылка».
 *
 *   • кому: все активные пользователи с `isRoot`; почта — полная сводка,
 *     Telegram и MAX — сильно сокращённая (каналы и шаблон — в настройках);
 *   • когда: по расписанию (по умолчанию вс 23:59 МСК) — проверяет крон
 *     `/api/cron/mailing` раз в минуту — или кнопкой «Отправить сейчас»;
 *   • ИИ: задание `wesetup_admin_weekly_digest` в очередь диспетчера
 *     (`docs/ai-dispatcher.md`). Не ответил — сводка всё равно уходит с
 *     рекомендациями по правилам и пометкой об этом;
 *   • повтор: слот расписания записывается в историю ДО отправки, поэтому
 *     упавший посередине проход не пришлёт сводку дважды.
 *
 * Настройки и история — `PlatformSetting` (`mailing.aiDigest.*`).
 */

export const AI_DIGEST_CONFIG_KEY = "mailing.aiDigest.config";
export const AI_DIGEST_RUNS_KEY = "mailing.aiDigest.runs";
const RUNS_KEEP = 20;
/** У скольких последних запусков храним письмо целиком (для просмотра). */
const RUNS_KEEP_HTML = 4;
/** «Отправляется» дольше этого — проход упал. */
const STALE_RUN_MS = 15 * 60_000;
const AI_DEADLINE_MS = 150_000;
const LOCK_KEY = "mailing:ai-digest";

export type AiDigestDelivery = {
  channel: AiDigestChannel;
  recipient: string;
  status: "sent" | "failed" | "skipped";
  detail: string | null;
};

export type AiDigestRun = {
  id: string;
  trigger: "schedule" | "manual";
  slotKey: string | null;
  actor: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "sent" | "partial" | "failed";
  period: string | null;
  ai: "ok" | "fallback" | null;
  aiNote: string | null;
  subject: string | null;
  short: string | null;
  html: string | null;
  revenue: number | null;
  orders: number | null;
  avgCheck: number | null;
  deliveries: AiDigestDelivery[];
  error: string | null;
};

export type AiDigestRecipient = {
  id: string;
  name: string;
  email: string;
  telegram: boolean;
  max: boolean;
};

// ── хранилище ──────────────────────────────────────────────────────────

async function readSetting(key: string): Promise<unknown> {
  const row = await db.platformSetting.findUnique({ where: { key } });
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  await db.platformSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}

export async function readAiDigestConfig(): Promise<AiDigestConfig> {
  try {
    return normalizeAiDigestConfig(await readSetting(AI_DIGEST_CONFIG_KEY));
  } catch (error) {
    console.error("[ai-digest] config read failed — defaults", error);
    return normalizeAiDigestConfig(null);
  }
}

export async function writeAiDigestConfig(config: AiDigestConfig): Promise<AiDigestConfig> {
  const normalized = normalizeAiDigestConfig(config);
  await writeSetting(AI_DIGEST_CONFIG_KEY, normalized);
  return normalized;
}

function normalizeRuns(raw: unknown, now: Date): AiDigestRun[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is AiDigestRun => Boolean(r) && typeof r === "object" && typeof (r as AiDigestRun).id === "string")
    .map((r) =>
      r.status === "running" && now.getTime() - Date.parse(r.startedAt) > STALE_RUN_MS
        ? { ...r, status: "failed" as const, error: r.error ?? "Проход прервался (сервер перезапускался) — сводка могла не уйти" }
        : r
    );
}

export async function readAiDigestRuns(now: Date = new Date()): Promise<AiDigestRun[]> {
  try {
    return normalizeRuns(await readSetting(AI_DIGEST_RUNS_KEY), now);
  } catch (error) {
    console.error("[ai-digest] runs read failed", error);
    return [];
  }
}

function trimRuns(runs: AiDigestRun[]): AiDigestRun[] {
  return runs.slice(0, RUNS_KEEP).map((r, i) => (i < RUNS_KEEP_HTML ? r : { ...r, html: null }));
}

/** Изменение истории под замком: два прохода не перетирают друг друга. */
async function mutateRuns<T>(fn: (runs: AiDigestRun[]) => { runs: AiDigestRun[]; value: T }): Promise<T | null> {
  const outcome = await withAdvisoryTryLock(
    LOCK_KEY,
    async () => {
      const current = await readAiDigestRuns();
      const { runs, value } = fn(current);
      await writeSetting(AI_DIGEST_RUNS_KEY, trimRuns(runs));
      return value;
    },
    { attempts: 40, timeoutMs: 20_000 }
  );
  return outcome.acquired ? outcome.value : null;
}

// ── получатели ─────────────────────────────────────────────────────────

async function loadRootUsers() {
  return db.user.findMany({
    where: { isRoot: true, isActive: true, archivedAt: null },
    select: { id: true, name: true, email: true, telegramChatId: true, maxIdentity: { select: { privateChatId: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function listAiDigestRecipients(): Promise<AiDigestRecipient[]> {
  const users = await loadRootUsers();
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    telegram: Boolean(u.telegramChatId),
    max: Boolean(u.maxIdentity?.privateChatId),
  }));
}

// ── сборка ─────────────────────────────────────────────────────────────

export type BuiltDigest = {
  metrics: DigestMetrics;
  narrative: AiDigestNarrative;
  ai: "ok" | "fallback";
  aiNote: string | null;
  rendered: RenderedDigest;
  html: string;
};

function aiFailureNote(code: string, error: string): string {
  if (code === "not_configured") return "ИИ не подключён (диспетчер не настроен) — рекомендации составлены по правилам.";
  if (code === "timeout") return "ИИ не ответил вовремя — рекомендации составлены по правилам.";
  if (/wrong_worker/.test(error)) {
    return "Воркер ИИ не знает задание сводки — перезапустите dispatcher/wesetup-worker.ps1. Рекомендации составлены по правилам.";
  }
  return "ИИ не справился с заданием — рекомендации составлены по правилам.";
}

export function appUrl(): string {
  return (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/+$/, "");
}

export function wrapDigestEmail(rendered: RenderedDigest): string {
  return renderEmailLayout(escapeHtml(rendered.subject), rendered.bodyHtml, null, {
    preheader: rendered.preheader,
    footerHtml:
      `<p style="margin:6px 0 0;font-size:12px;color:#a1a1aa;text-align:center">` +
      `Еженедельная ИИ-сводка администратору платформы WeSetup. Короткая версия приходит в Telegram и MAX.</p>`,
  });
}

/**
 * Цифры недели + текст ИИ (или запасной) → письмо и короткий текст.
 * `ai: false` — без ИИ (быстрый предпросмотр).
 */
export async function buildAiDigest(
  config: AiDigestConfig,
  options: { at: Date; now?: Date; ai: boolean }
): Promise<BuiltDigest> {
  const period = reportPeriod(options.at);
  const metrics = await collectDigestMetrics(period, options.now ?? new Date());
  let narrative: AiDigestNarrative | null = null;
  let aiNote: string | null = null;
  if (options.ai) {
    try {
      const result = await enqueueAndWait(buildAiDigestPrompt(metrics, config), { deadlineMs: AI_DEADLINE_MS });
      if (result.ok) {
        narrative = parseAiDigestReply(result.text, config.recommendationsCount);
        if (!narrative) aiNote = "Ответ ИИ не удалось разобрать — рекомендации составлены по правилам.";
      } else {
        aiNote = aiFailureNote(result.code, result.error);
        console.warn(`[ai-digest] AI failed: ${result.code} ${result.error}`);
      }
    } catch (error) {
      console.error("[ai-digest] AI request failed", error);
      aiNote = "ИИ недоступен — рекомендации составлены по правилам.";
    }
  } else {
    aiNote = "Предпросмотр без ИИ: рекомендации составлены по правилам, в настоящей сводке их напишет ИИ.";
  }
  const ai = narrative ? "ok" : "fallback";
  const finalNarrative = narrative ?? fallbackNarrative(metrics, config.recommendationsCount);
  const rendered = renderDigest(metrics, finalNarrative, config, { appUrl: appUrl(), aiNote });
  return { metrics, narrative: finalNarrative, ai, aiNote, rendered, html: wrapDigestEmail(rendered) };
}

// ── доставка ───────────────────────────────────────────────────────────

async function deliver(
  runId: string,
  config: AiDigestConfig,
  built: BuiltDigest
): Promise<AiDigestDelivery[]> {
  const users = await loadRootUsers();
  const dryRun = mailingDryRunDir();
  const out: AiDigestDelivery[] = [];
  if (users.length === 0) {
    return [{ channel: "email", recipient: "—", status: "failed", detail: "Нет активных пользователей root" }];
  }
  const { rendered, html } = built;

  let maxReady: { ok: true } | { ok: false; reason: string } = { ok: false, reason: "Бот MAX не настроен" };
  if (config.channels.max) {
    try {
      const { maxConfig } = await import("@/lib/max/config");
      if (maxConfig().token) maxReady = { ok: true };
    } catch {
      maxReady = { ok: false, reason: "Настройки бота MAX с ошибкой" };
    }
  }

  for (const user of users) {
    const who = user.name || user.email;
    for (const channel of AI_DIGEST_CHANNELS) {
      if (!config.channels[channel]) continue;
      try {
        if (channel === "email") {
          if (!user.email) {
            out.push({ channel, recipient: who, status: "skipped", detail: "Нет почты" });
            continue;
          }
          if (dryRun) {
            await writeDryRunFile(`ai-digest-${runId}`, user.id, "email.html", html);
            out.push({ channel, recipient: who, status: "sent", detail: "Сухая отправка: письмо записано в папку" });
            continue;
          }
          const ok = await sendRawEmail(user.email, rendered.subject, html, { text: rendered.text });
          out.push({ channel, recipient: who, status: ok ? "sent" : "failed", detail: ok ? user.email : "Почтовый сервер не принял письмо" });
        } else if (channel === "telegram") {
          if (!user.telegramChatId) {
            out.push({ channel, recipient: who, status: "skipped", detail: "Telegram не привязан" });
            continue;
          }
          if (!telegramBotConfigured()) {
            out.push({ channel, recipient: who, status: "skipped", detail: "Бот Telegram не настроен" });
            continue;
          }
          if (dryRun) {
            await writeDryRunFile(`ai-digest-${runId}`, user.id, "telegram.txt", rendered.telegram);
            out.push({ channel, recipient: who, status: "sent", detail: "Сухая отправка: текст записан в папку" });
            continue;
          }
          const { sendTelegramMessage } = await import("@/lib/telegram");
          // Без userId: время отправки выбрал сам администратор — тихие часы не откладывают сводку.
          const ok = await sendTelegramMessage(user.telegramChatId, rendered.telegram, {
            delivery: { kind: "admin:ai_weekly_digest", dedupeKey: `ai-digest:${runId}:${user.id}` },
          });
          out.push({ channel, recipient: who, status: ok ? "sent" : "failed", detail: ok ? null : "Telegram не принял сообщение" });
        } else {
          const chatId = user.maxIdentity?.privateChatId;
          if (!chatId) {
            out.push({ channel, recipient: who, status: "skipped", detail: "MAX не привязан" });
            continue;
          }
          if (!maxReady.ok) {
            out.push({ channel, recipient: who, status: "skipped", detail: maxReady.reason });
            continue;
          }
          if (dryRun) {
            await writeDryRunFile(`ai-digest-${runId}`, user.id, "max.txt", rendered.max);
            out.push({ channel, recipient: who, status: "sent", detail: "Сухая отправка: текст записан в папку" });
            continue;
          }
          const { maxSend } = await import("@/lib/max/client");
          await maxSend(chatId, rendered.max);
          out.push({ channel, recipient: who, status: "sent", detail: null });
        }
      } catch (error) {
        console.error(`[ai-digest] ${channel} → ${user.id} failed`, error);
        out.push({ channel, recipient: who, status: "failed", detail: error instanceof Error ? error.message.slice(0, 200) : "Ошибка отправки" });
      }
    }
  }

  // Дополнительные получатели в Telegram — те, у кого нет своего root.
  if (config.channels.telegram && config.telegramExtra.length > 0) {
    const rootChats = new Set(users.map((u) => u.telegramChatId).filter(Boolean));
    for (const extra of config.telegramExtra) {
      const who = extra.label || extra.chatId;
      if (rootChats.has(extra.chatId)) continue;
      try {
        if (!telegramBotConfigured()) {
          out.push({ channel: "telegram", recipient: who, status: "skipped", detail: "Бот Telegram не настроен" });
          continue;
        }
        if (dryRun) {
          await writeDryRunFile(`ai-digest-${runId}`, `tg-${extra.chatId}`, "telegram.txt", rendered.telegram);
          out.push({ channel: "telegram", recipient: who, status: "sent", detail: "Сухая отправка: текст записан в папку" });
          continue;
        }
        const { sendTelegramMessage } = await import("@/lib/telegram");
        const ok = await sendTelegramMessage(extra.chatId, rendered.telegram, {
          delivery: { kind: "admin:ai_weekly_digest", dedupeKey: `ai-digest:${runId}:tg:${extra.chatId}` },
        });
        out.push({
          channel: "telegram",
          recipient: who,
          status: ok ? "sent" : "failed",
          detail: ok ? null : "Telegram не принял сообщение — человек должен нажать «Старт» у бота",
        });
      } catch (error) {
        console.error(`[ai-digest] telegram → ${extra.chatId} failed`, error);
        out.push({ channel: "telegram", recipient: who, status: "failed", detail: error instanceof Error ? error.message.slice(0, 200) : "Ошибка отправки" });
      }
    }
  }
  return out;
}

function overallStatus(deliveries: AiDigestDelivery[]): AiDigestRun["status"] {
  const sent = deliveries.filter((d) => d.status === "sent").length;
  const failed = deliveries.filter((d) => d.status === "failed").length;
  if (sent === 0) return "failed";
  return failed > 0 ? "partial" : "sent";
}

// ── запуск ─────────────────────────────────────────────────────────────

export type AiDigestRunResult =
  | { started: false; reason: "disabled" | "not-due" | "busy" | "already-running" }
  | { started: true; run: AiDigestRun };

function emptyRun(trigger: AiDigestRun["trigger"], key: string | null, actor: string | null, now: Date): AiDigestRun {
  return {
    id: randomUUID(),
    trigger,
    slotKey: key,
    actor,
    startedAt: now.toISOString(),
    finishedAt: null,
    status: "running",
    period: null,
    ai: null,
    aiNote: null,
    subject: null,
    short: null,
    html: null,
    revenue: null,
    orders: null,
    avgCheck: null,
    deliveries: [],
    error: null,
  };
}

async function execute(run: AiDigestRun, config: AiDigestConfig, at: Date): Promise<AiDigestRun> {
  let finished: AiDigestRun;
  try {
    const built = await buildAiDigest(config, { at, ai: true });
    const deliveries = await deliver(run.id, config, built);
    finished = {
      ...run,
      finishedAt: new Date().toISOString(),
      status: overallStatus(deliveries),
      period: built.metrics.periodLabel,
      ai: built.ai,
      aiNote: built.ai === "ok" ? null : built.aiNote,
      subject: built.rendered.subject,
      short: built.rendered.max,
      html: built.html,
      revenue: built.metrics.current.sales.revenue,
      orders: built.metrics.current.sales.orders,
      avgCheck: built.metrics.current.sales.avgCheck,
      deliveries,
    };
  } catch (error) {
    console.error("[ai-digest] run failed", error);
    finished = {
      ...run,
      finishedAt: new Date().toISOString(),
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 300) : "Ошибка сборки сводки",
    };
  }
  await mutateRuns((runs) => ({ runs: runs.map((r) => (r.id === finished.id ? finished : r)), value: null }));
  console.info(`[ai-digest] run ${finished.id} (${finished.trigger}) → ${finished.status}`, {
    deliveries: finished.deliveries.map((d) => `${d.channel}:${d.status}`),
  });
  return finished;
}

/**
 * Проверка расписания — из крона раз в минуту. Слот наступил и ещё не
 * отправлен → запись «отправляется» в историю (под замком) → сборка с ИИ
 * (до ~2,5 мин) → отправка.
 */
export async function tickAiDigest(now: Date = new Date()): Promise<AiDigestRunResult> {
  const config = await readAiDigestConfig();
  if (!config.enabled) return { started: false, reason: "disabled" };
  const sentKeys = (runs: AiDigestRun[]) => new Set(runs.map((r) => r.slotKey).filter((k): k is string => Boolean(k)));
  // Дешёвая проверка без замка и записи: почти каждую минуту слот не наступил.
  if (!dueSlot(now, config.schedule, sentKeys(await readAiDigestRuns(now)))) return { started: false, reason: "not-due" };
  const claimed = await mutateRuns<AiDigestRun | null>((runs) => {
    const slot = dueSlot(now, config.schedule, sentKeys(runs));
    if (!slot) return { runs, value: null };
    const run = emptyRun("schedule", slotKey(slot), null, now);
    return { runs: [run, ...runs], value: run };
  });
  if (claimed === null) return { started: false, reason: "not-due" };
  // Неделя — по моменту слота, а не по моменту проверки (крон мог опоздать за полночь).
  const slotAt = new Date(Date.parse(`${claimed.slotKey}:00+03:00`));
  return { started: true, run: await execute(claimed, config, Number.isNaN(slotAt.getTime()) ? now : slotAt) };
}

/**
 * «Отправить сейчас» из ROOT: вне расписания, слот не занимает. Запись
 * «отправляется» появляется сразу, а сборка с ИИ (до ~2,5 мин) идёт в
 * `finish` — маршрут зовёт её после ответа (`after`), страница опрашивает
 * историю.
 */
export async function startAiDigestNow(
  actor: string,
  now: Date = new Date()
): Promise<{ started: false; reason: "busy" | "already-running" } | { started: true; run: AiDigestRun; finish: () => Promise<AiDigestRun> }> {
  const config = await readAiDigestConfig();
  const claimed = await mutateRuns<AiDigestRun | "busy">((runs) => {
    if (runs.some((r) => r.status === "running")) return { runs, value: "busy" };
    const run = emptyRun("manual", null, actor, now);
    return { runs: [run, ...runs], value: run };
  });
  if (claimed === null) return { started: false, reason: "busy" };
  if (claimed === "busy") return { started: false, reason: "already-running" };
  return { started: true, run: claimed, finish: () => execute(claimed, config, now) };
}

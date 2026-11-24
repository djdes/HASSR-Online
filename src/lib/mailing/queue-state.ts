/**
 * «Состояние очереди» рассылки — как в YesBeat (`Mailings::queue_verdict`):
 * сколько получателей ждут и почему, когда ближайшая попытка, как они
 * распределены по часам, работает ли обработчик и что мешает отправке.
 *
 * Чистый модуль: строки на вход, понятные проблемы на выход. Читают
 * сервер, экраны ROOT и тесты.
 */

import { humanMsk } from "./forecast";
import { waitReasonLabel } from "./labels";

/** Обработчик молчит дольше — cron не работает. */
export const HEARTBEAT_STALE_MS = 5 * 60 * 1000;

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type WaitingRow = {
  waitReason: string | null;
  nextAttemptAt: Date | null;
  emailQueued: boolean;
};

export type WaitingGroup = {
  /** null — время пришло, ждёт своей очереди в проходе. */
  reason: string | null;
  label: string;
  count: number;
  /** Ближайшая попытка в группе (не раньше «сейчас»). */
  nextAt: string;
};

export type HourSlot = {
  /** Начало часа по Москве — «ГГГГ-ММ-ДДTЧЧ». */
  hour: string;
  count: number;
};

export type QueueIssue = { level: "error" | "warning" | "info"; text: string };

export type QueueSummary = {
  total: number;
  emailWaiting: number;
  waiting: WaitingGroup[];
  plan: HourSlot[];
  nextAt: string | null;
};

/** Причина, под которой строка видна сейчас: наступило время — «ждёт очереди», кроме общего лимита. */
function visibleReason(row: WaitingRow, now: Date): string | null {
  if (row.waitReason === "global_limit") return row.waitReason;
  if (!row.nextAttemptAt || row.nextAttemptAt.getTime() <= now.getTime()) return null;
  return row.waitReason ?? "retry";
}

function mskHourKey(at: Date): string {
  return new Date(at.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 13);
}

export function summarizeQueue(rows: WaitingRow[], now: Date, planHours = 48): QueueSummary {
  const groups = new Map<string, { reason: string | null; count: number; next: number }>();
  const slots = new Map<string, number>();
  let emailWaiting = 0;
  let next: number | null = null;
  for (const row of rows) {
    const at = Math.max(now.getTime(), row.nextAttemptAt?.getTime() ?? now.getTime());
    const reason = visibleReason(row, now);
    const key = reason ?? "";
    const g = groups.get(key) ?? { reason, count: 0, next: at };
    g.count += 1;
    g.next = Math.min(g.next, at);
    groups.set(key, g);
    const hour = mskHourKey(new Date(at - (at % HOUR_MS)));
    slots.set(hour, (slots.get(hour) ?? 0) + 1);
    if (row.emailQueued) emailWaiting += 1;
    next = next === null ? at : Math.min(next, at);
  }
  return {
    total: rows.length,
    emailWaiting,
    waiting: [...groups.values()]
      .sort((a, b) => b.count - a.count)
      .map((g) => ({ reason: g.reason, label: waitReasonLabel(g.reason), count: g.count, nextAt: new Date(g.next).toISOString() })),
    plan: [...slots]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, planHours)
      .map(([hour, count]) => ({ hour, count })),
    nextAt: next === null ? null : new Date(next).toISOString(),
  };
}

export type VerdictInput = {
  status: string;
  scheduledAt: Date | null;
  pausedBy: string | null;
  summary: QueueSummary;
  enabled: boolean;
  heartbeat: Date | null;
  perDay: number;
  sentToday: number;
  /** Окно отправки рассылки по Москве. */
  windowStart: number;
  windowEnd: number;
  now: Date;
};

export function queueVerdict(input: VerdictInput): { issues: QueueIssue[]; stale: boolean } {
  const { summary, now } = input;
  const issues: QueueIssue[] = [];
  const stale = !input.heartbeat || input.heartbeat.getTime() < now.getTime() - HEARTBEAT_STALE_MS;
  const active = input.status === "sending" || input.status === "scheduled";
  if (active && summary.total > 0) {
    if (!input.enabled) {
      issues.push({ level: "error", text: "Очередь выключена во вкладке «Лимиты» — рассылки не отправляются." });
    }
    if (stale) {
      issues.push({
        level: "error",
        text: `Обработчик очереди ${input.heartbeat ? `не запускался с ${humanMsk(input.heartbeat)} МСК` : "ещё ни разу не запускался"} (должен каждую минуту). Проверьте cron /api/cron/mailing на сервере.`,
      });
    }
    if (input.scheduledAt && input.scheduledAt.getTime() > now.getTime()) {
      issues.push({ level: "info", text: `Старт по расписанию: ${humanMsk(input.scheduledAt)} МСК.` });
    } else if (summary.nextAt && new Date(summary.nextAt).getTime() > now.getTime()) {
      issues.push({
        level: "info",
        text: `Ближайшая попытка: ${humanMsk(summary.nextAt)} МСК. До этого оставшиеся получатели ждут — причины ниже.`,
      });
    }
    // Дневной лимит общий для всех рассылок: прямо сказать, что часть уйдёт завтра.
    const left = Math.max(0, input.perDay - input.sentToday);
    if (summary.emailWaiting > left) {
      issues.push({
        level: "warning",
        text: `Дневной лимит: сегодня можно отправить ещё ${left} из ${summary.emailWaiting} ждущих писем, остальные уйдут завтра. Чтобы отправить сегодня — увеличьте «Писем в сутки» в лимитах.`,
      });
    }
    if (!(input.windowStart === 0 && input.windowEnd === 24)) {
      issues.push({
        level: "info",
        text: `Часы отправки: ${String(input.windowStart).padStart(2, "0")}:00–${String(input.windowEnd).padStart(2, "0")}:00 МСК — вне них очередь ждёт.`,
      });
    }
  }
  if (input.status === "paused") {
    issues.push({
      level: "warning",
      text: `Рассылка на паузе${input.pausedBy ? ` (${input.pausedBy})` : ""} — нажмите «Продолжить», чтобы отправка пошла дальше.`,
    });
  }
  return { issues, stale };
}

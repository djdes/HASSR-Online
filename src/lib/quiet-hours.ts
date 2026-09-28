/**
 * Тихие часы для Telegram-уведомлений: не-срочные сообщения откладываются
 * до конца окна по часовому поясу организации. Срочные (температура,
 * отклонения, инциденты) уходят сразу.
 */
export type QuietHours = { enabled: boolean; from: string; to: string };

export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: false, from: "22:00", to: "08:00" };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseQuietHours(raw: unknown): QuietHours | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Partial<QuietHours>;
  if (q.enabled !== true) return null;
  if (typeof q.from !== "string" || typeof q.to !== "string" || !TIME_RE.test(q.from) || !TIME_RE.test(q.to) || q.from === q.to) return null;
  return { enabled: true, from: q.from, to: q.to };
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Локальные минуты от полуночи в поясе организации. */
export function localMinutes(now: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h * 60 + m;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/** Когда тихие часы закончатся; null — сейчас не тихо. */
export function quietUntil(now: Date, timeZone: string, quiet: QuietHours | null): Date | null {
  if (!quiet) return null;
  const cur = localMinutes(now, timeZone);
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  const inWindow = from < to ? cur >= from && cur < to : cur >= from || cur < to;
  if (!inWindow) return null;
  const minutesLeft = to > cur ? to - cur : 24 * 60 - cur + to;
  return new Date(now.getTime() + minutesLeft * 60_000);
}

// login-code: код входа живёт 5 минут — отложенный до утра, он не даёт войти
// ночью, а утром приходит уже протухшим.
const URGENT = ["temperature", "deviation", "incident", "escalat", "alarm", "sos", "login-code"];

export function isUrgentKind(kind: string | null | undefined): boolean {
  if (!kind) return false;
  const k = kind.toLowerCase();
  return URGENT.some((u) => k.includes(u));
}

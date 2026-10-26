const MINUTE = 60_000;
const BURST_WINDOW = 10_000;
const MAX_SUBJECTS = 20_000;

/**
 * Budgets per subject (verified user or guest IP). Deliberately loose: a
 * person clicking through pages never gets near them, only machine-speed
 * crawling does. Keep each minute budget below six bursts, or it never binds.
 */
export const PAGE_NAVIGATION_LIMITS = {
  /** Document loads from a browser: per 10 seconds and per minute. */
  browser: { burst: 100, minute: 400 },
  /** Document loads with an empty or tool user-agent (curl, python-requests…). */
  automated: { burst: 20, minute: 90 },
  /** Next.js RSC fetches and prefetches per minute; their overflow waits alone. */
  background: 1200,
  /** Pause after a document budget is exceeded. */
  cooldownSeconds: 15,
  /**
   * Verified accounts (JWT): every budget times this. Registration is open,
   * so an account raises the limit but never lifts it.
   */
  userScale: 3,
  /** Guests with a signed visitor cookie: their shared ceiling per IP, times the normal budget. */
  visitorIpScale: 3,
} as const;
const COOLDOWN = PAGE_NAVIGATION_LIMITS.cooldownSeconds * 1000;

/** Why a request waits: for the limiter's statistics. */
export type PageLimitReason = "cooldown" | "burst" | "minute" | "background" | "capacity";
export type PageLimitDecision = { wait: number; reason: PageLimitReason | null };

type Visits = { pages: number[]; prefetches: number[]; blockedUntil: number; touched: number };

const scaled = (budget: number, scale: number) => Math.max(1, Math.floor(budget * scale));

/** Process-local rolling windows. The caller supplies only a verified subject. */
export function createPageNavigationLimiter(now = Date.now, maxSubjects = MAX_SUBJECTS) {
  const subjects = new Map<string, Visits>();
  let nextSweep = 0;
  const pass: PageLimitDecision = { wait: 0, reason: null };

  function sweep(time: number) {
    if (time < nextSweep) return;
    for (const [key, entry] of subjects) {
      if (time - entry.touched >= MINUTE && entry.blockedUntil <= time) subjects.delete(key);
    }
    nextSweep = time + MINUTE;
  }

  /** `scale` multiplies every budget of this check (accounts, the env switch). */
  function decide(subject: string, automated: boolean, prefetch: boolean, scale = 1): PageLimitDecision {
    const time = now();
    sweep(time);
    let entry = subjects.get(subject);
    if (!entry) {
      // Keep existing budgets intact at capacity: unseen subjects wait until expiry.
      if (subjects.size >= maxSubjects) return { wait: Math.max(1, Math.ceil((nextSweep - time) / 1000)), reason: "capacity" };
      entry = { pages: [], prefetches: [], blockedUntil: 0, touched: time };
      subjects.set(subject, entry);
    }
    entry.touched = time;
    if (entry.blockedUntil > time) return { wait: Math.ceil((entry.blockedUntil - time) / 1000), reason: "cooldown" };
    if (entry.blockedUntil) {
      entry.pages = [];
      entry.blockedUntil = 0;
    }
    entry.pages = entry.pages.filter((at) => at > time - MINUTE);
    entry.prefetches = entry.prefetches.filter((at) => at > time - MINUTE);
    // Speculative Next.js traffic must never put actual documents on cooldown.
    // Reject only background requests until a slot in their rolling window opens.
    if (prefetch) {
      if (entry.prefetches.length >= scaled(PAGE_NAVIGATION_LIMITS.background, scale)) {
        return { wait: Math.ceil((entry.prefetches[0] + MINUTE - time) / 1000), reason: "background" };
      }
      entry.prefetches.push(time);
      return pass;
    }
    const budget = automated ? PAGE_NAVIGATION_LIMITS.automated : PAGE_NAVIGATION_LIMITS.browser;
    const overMinute = entry.pages.length >= scaled(budget.minute, scale);
    if (overMinute || entry.pages.filter((at) => at > time - BURST_WINDOW).length >= scaled(budget.burst, scale)) {
      entry.blockedUntil = time + COOLDOWN;
      return { wait: PAGE_NAVIGATION_LIMITS.cooldownSeconds, reason: overMinute ? "minute" : "burst" };
    }
    entry.pages.push(time);
    return pass;
  }

  return {
    get size() { return subjects.size; },
    /** The subject already has a budget, or there is room for a new one. */
    admits(subject: string): boolean {
      if (subjects.has(subject)) return true;
      // A full table frees its idle entries here too: otherwise only known
      // subjects would ever sweep it, and new ones would wait forever.
      if (subjects.size >= maxSubjects) sweep(now());
      return subjects.size < maxSubjects;
    },
    decide,
    /** Seconds to wait, 0 when the request passes. */
    check(subject: string, automated: boolean, prefetch: boolean, scale = 1): number {
      return decide(subject, automated, prefetch, scale).wait;
    },
  };
}

/**
 * Emergency switch, read on every check (a restart with `--update-env`
 * applies it): `PAGE_NAVIGATION_LIMIT=off` never answers 429,
 * `PAGE_NAVIGATION_LIMIT_SCALE` (0.25…100) multiplies every budget.
 * Anything else — the normal limits.
 */
export function pageLimitMode(env: Record<string, string | undefined> = process.env): { off: boolean; scale: number } {
  const scale = Number(env.PAGE_NAVIGATION_LIMIT_SCALE);
  return {
    off: env.PAGE_NAVIGATION_LIMIT?.trim().toLowerCase() === "off",
    scale: Number.isFinite(scale) && scale >= 0.25 && scale <= 100 ? scale : 1,
  };
}

export function hasAutomationUserAgent(userAgent: string | null): boolean {
  return !userAgent?.trim() || /curl|wget|python-requests|python-urllib|scrapy|httrack|headlesschrome|playwright|puppeteer/i.test(userAgent);
}

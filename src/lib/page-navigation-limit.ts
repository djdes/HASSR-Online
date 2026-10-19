const MINUTE = 60_000;
const COOLDOWN = 30_000;
const MAX_SUBJECTS = 5_000;

type Visits = { pages: number[]; prefetches: number[]; blockedUntil: number; touched: number };

/** Process-local rolling windows. The caller supplies only a verified subject. */
export function createPageNavigationLimiter(now = Date.now, maxSubjects = MAX_SUBJECTS) {
  const subjects = new Map<string, Visits>();
  let nextSweep = 0;
  return {
    get size() { return subjects.size; },
    check(subject: string, automated: boolean, prefetch: boolean): number {
      const time = now();
      if (time >= nextSweep) {
        for (const [key, entry] of subjects) {
          if (time - entry.touched >= MINUTE && entry.blockedUntil <= time) subjects.delete(key);
        }
        nextSweep = time + MINUTE;
      }
      let entry = subjects.get(subject);
      if (!entry) {
        // Keep existing budgets intact at capacity: unseen subjects wait until expiry.
        if (subjects.size >= maxSubjects) return Math.max(1, Math.ceil((nextSweep - time) / 1000));
        entry = { pages: [], prefetches: [], blockedUntil: 0, touched: time };
        subjects.set(subject, entry);
      }
      entry.touched = time;
      if (entry.blockedUntil > time) return Math.ceil((entry.blockedUntil - time) / 1000);
      if (entry.blockedUntil) {
        entry.pages = [];
        entry.blockedUntil = 0;
      }
      entry.pages = entry.pages.filter((at) => at > time - MINUTE);
      entry.prefetches = entry.prefetches.filter((at) => at > time - MINUTE);
      // Speculative Next.js traffic must never put actual documents on cooldown.
      // Reject only background requests until a slot in their rolling window opens.
      if (prefetch) {
        if (entry.prefetches.length >= 240) {
          return Math.ceil((entry.prefetches[0] + MINUTE - time) / 1000);
        }
        entry.prefetches.push(time);
        return 0;
      }
      const exceeded = entry.pages.length >= (automated ? 30 : 120) ||
        entry.pages.filter((at) => at > time - 10_000).length >= (automated ? 6 : 20);
      if (exceeded) {
        entry.blockedUntil = time + COOLDOWN;
        return COOLDOWN / 1000;
      }
      entry.pages.push(time);
      return 0;
    },
  };
}

export function hasAutomationUserAgent(userAgent: string | null): boolean {
  return !userAgent?.trim() || /curl|wget|python-requests|python-urllib|scrapy|httrack|headlesschrome|playwright|puppeteer/i.test(userAgent);
}

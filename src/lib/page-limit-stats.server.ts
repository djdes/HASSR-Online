import { db } from "@/lib/db";
import {
  moscowDay,
  restorePageLimitStats,
  takePageLimitStats,
  type PageLimitBucket,
} from "@/lib/page-limit-stats";

/**
 * Moves the limiter's in-memory counts (see page-limit-stats.ts) to
 * `PageLimitStat` once a minute and reads them for /root/page-limit. A
 * failed write puts the counts back and never touches the request path: the
 * site works the same with the database down, only the statistics wait.
 */

const FLUSH_EVERY = 60_000;
const KEEP_DAYS = 90;
const DAY = 86_400_000;
const STARTED = Symbol.for("wesetup.pageLimitStatsFlusher");

let cleanedDay = "";

const dateOf = (day: string) => new Date(`${day}T00:00:00.000Z`);

function save({ count, ...bucket }: PageLimitBucket) {
  const key = { ...bucket, day: dateOf(bucket.day) };
  return db.pageLimitStat.upsert({
    where: { bucket: key },
    create: { ...key, count },
    update: { count: { increment: count } },
  });
}

/** Returns how many buckets were saved. */
export async function flushPageLimitStats(now = Date.now()): Promise<number> {
  const buckets = takePageLimitStats();
  if (buckets.length === 0) return 0;
  try {
    await db.$transaction(buckets.map(save));
  } catch (error) {
    restorePageLimitStats(buckets);
    console.error("[page-limit-stats] write failed:", error instanceof Error ? error.message : error);
    return 0;
  }
  const today = moscowDay(now);
  if (cleanedDay !== today) {
    cleanedDay = today;
    await db.pageLimitStat
      .deleteMany({ where: { day: { lt: dateOf(moscowDay(now - KEEP_DAYS * DAY)) } } })
      .catch((error: unknown) => console.error("[page-limit-stats] cleanup failed:", error instanceof Error ? error.message : error));
  }
  return buckets.length;
}

/** Once per process (instrumentation.ts); the timer never keeps it alive. */
export function startPageLimitStatsFlusher(): void {
  const global = globalThis as { [STARTED]?: boolean };
  if (global[STARTED]) return;
  global[STARTED] = true;
  const timer = setInterval(() => {
    flushPageLimitStats().catch(() => undefined);
  }, FLUSH_EVERY);
  timer.unref?.();
}

export type PageLimitCount = { value: string; passed: number; limited: number };

export type PageLimitOverview = {
  days: { day: string; passed: number; limited: number; limitedBySubject: Record<string, number> }[];
  /** Pages and 429 by each dimension over the whole period. Sections: 429 only. */
  by: Record<"subject" | "reason" | "client" | "platform" | "request" | "metadata" | "section", PageLimitCount[]>;
  passed: number;
  limited: number;
};

const DIMENSIONS = ["subject", "reason", "client", "platform", "request", "metadata", "section"] as const;

/** The last `days` Moscow days, newest first. */
export async function readPageLimitOverview(days = 7, now = Date.now()): Promise<PageLimitOverview> {
  const dayKeys = Array.from({ length: days }, (_, index) => moscowDay(now - index * DAY));
  const rows = await db.pageLimitStat.findMany({
    where: { day: { gte: dateOf(dayKeys[dayKeys.length - 1]) } },
    select: { day: true, outcome: true, reason: true, subject: true, client: true, platform: true, request: true, metadata: true, section: true, count: true },
    take: 50_000,
  });
  const perDay = new Map(dayKeys.map((day) => [day, { day, passed: 0, limited: 0, limitedBySubject: {} as Record<string, number> }]));
  const by = Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, new Map<string, PageLimitCount>()])) as Record<(typeof DIMENSIONS)[number], Map<string, PageLimitCount>>;
  let passed = 0;
  let limited = 0;
  for (const row of rows) {
    const day = perDay.get(row.day.toISOString().slice(0, 10));
    const isLimited = row.outcome === "limited";
    if (isLimited) limited += row.count;
    else passed += row.count;
    if (day) {
      if (isLimited) {
        day.limited += row.count;
        day.limitedBySubject[row.subject] = (day.limitedBySubject[row.subject] ?? 0) + row.count;
      } else {
        day.passed += row.count;
      }
    }
    for (const dimension of DIMENSIONS) {
      const value = dimension === "metadata" ? (row.metadata ? "yes" : "no") : row[dimension];
      // Passed pages carry no reason or section: those columns only describe 429.
      if (!isLimited && (dimension === "reason" || dimension === "section")) continue;
      const counts = by[dimension].get(value) ?? { value, passed: 0, limited: 0 };
      if (isLimited) counts.limited += row.count;
      else counts.passed += row.count;
      by[dimension].set(value, counts);
    }
  }
  const sorted = (counts: Map<string, PageLimitCount>) =>
    [...counts.values()].sort((a, b) => b.limited - a.limited || b.passed - a.passed);
  return {
    days: [...perDay.values()],
    by: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, sorted(by[dimension])])) as PageLimitOverview["by"],
    passed,
    limited,
  };
}

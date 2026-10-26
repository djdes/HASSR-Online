import type { PageLimitReason } from "./page-navigation-limit";

/**
 * Statistics of the page navigation limiter: how many pages passed and how
 * many got a 429, by coarse dimensions only — never an address, account,
 * cookie, full path or query. The proxy counts in process memory (cheap, no
 * I/O on the request path); `page-limit-stats.server.ts` moves the counts
 * to the database once a minute. The store lives on `globalThis`, so the
 * proxy bundle and the server code of the same process share it.
 */

export type PageLimitSubject = "user" | "visitor" | "ip" | "unknown";
export type PageLimitClient = "browser" | "automation" | "app" | "crawler" | "fake-crawler";
export type PageLimitPlatform = "ios-old" | "ios" | "android" | "desktop" | "other";

export type PageLimitEvent = {
  limited: boolean;
  reason: PageLimitReason | null;
  subject: PageLimitSubject;
  client: PageLimitClient;
  platform: PageLimitPlatform;
  background: boolean;
  metadata: boolean;
  section: string;
};

/** One counted bucket: a day (Moscow) and the event's dimensions. */
export type PageLimitBucket = {
  day: string;
  outcome: "passed" | "limited";
  reason: string;
  subject: PageLimitSubject;
  client: PageLimitClient;
  platform: PageLimitPlatform;
  request: "document" | "background";
  metadata: boolean;
  section: string;
  count: number;
};

/**
 * Top-level route segments worth naming in the statistics. Anything else
 * (an unknown path, an ID) is «other», so a crawler of random URLs cannot
 * grow the table.
 */
const SECTIONS = new Set([
  "acknowledge", "b", "batches", "blanki", "blog", "bonuses", "brakerazhnyy-zhurnal", "calc", "capa",
  "changes", "checklists", "compare", "competencies", "consent", "control-board", "dashboard",
  "delete-account", "developers", "dlya-azs", "dlya-bara", "dlya-detskogo-sada", "dlya-fastfuda",
  "dlya-fitnes-centra", "dlya-kafe", "dlya-keyteringa", "dlya-magazina", "dlya-medcentra", "dlya-otelya",
  "dlya-pekarni", "dlya-proizvodstva", "dlya-salona-krasoty", "dlya-stolovoy", "elektronnyy-zhurnal-sanpin",
  "en", "features", "glossary", "haccp-dlya-kafe", "ideas", "inspection", "inspector", "inspector-sheet",
  "join", "journal-fill", "journals", "journals-info", "journals-progress", "knowledge", "kp", "login",
  "losses", "master", "max", "mercury", "mini", "more", "oferta", "order", "orders", "p", "pair", "partner",
  "partner-agreement", "partners", "plans", "policy", "pricing", "prikazy", "privacy", "production-control",
  "promo", "q", "qb", "qj", "r", "register", "reports", "root", "sanpin", "settings", "setup-helper", "staff",
  "status", "team", "temperaturnyy-list-holodilnika", "terms", "translations", "unsubscribe", "uslugi", "uz",
  "v", "verifications", "whats-new", "zhurnal-haccp", "zhurnal-uborki", "zhurnal-zdorovya",
]);

export const PAGE_LIMIT_SECTIONS: ReadonlySet<string> = SECTIONS;

export function sectionOf(pathname: string): string {
  const first = pathname.split("/")[1] ?? "";
  if (!first) return "home";
  return SECTIONS.has(first) ? first : "other";
}

/** Old iOS (before 16.4) sends no Fetch Metadata: its prefetches look like page loads. */
export function platformOf(userAgent: string | null): PageLimitPlatform {
  if (!userAgent) return "other";
  // Two linear patterns: one with `.*?` between them is quadratic on a long header.
  if (/\b(?:iPhone|iPad|iPod)\b/.test(userAgent)) {
    const version = /\bOS (\d+)[_.](\d+)/.exec(userAgent);
    if (!version) return "ios";
    const major = Number(version[1]);
    const minor = Number(version[2]);
    return major < 16 || (major === 16 && minor < 4) ? "ios-old" : "ios";
  }
  if (/Android/i.test(userAgent)) return "android";
  if (/Windows NT|Macintosh|X11|CrOS/.test(userAgent)) return "desktop";
  return "other";
}

const DAY = 86_400_000;
const MOSCOW = 3 * 3_600_000;
const MAX_BUCKETS = 2_000;
const STORE = Symbol.for("wesetup.pageLimitStats");

type Store = { counts: Map<string, number> };

function store(): Store {
  const global = globalThis as { [STORE]?: Store };
  global[STORE] ??= { counts: new Map() };
  return global[STORE];
}

/** Moscow calendar day as YYYY-MM-DD. */
export function moscowDay(time: number): string {
  return new Date(Math.floor((time + MOSCOW) / DAY) * DAY).toISOString().slice(0, 10);
}

type BucketKey = Omit<PageLimitBucket, "count">;

function keyOf(bucket: BucketKey): string {
  return [bucket.day, bucket.outcome, bucket.reason, bucket.subject, bucket.client, bucket.platform, bucket.request, bucket.metadata ? "1" : "0", bucket.section].join("|");
}

function add(bucket: BucketKey, count: number): void {
  const current = store();
  const key = keyOf(bucket);
  const previous = current.counts.get(key);
  // Full: a new combination is not counted; known ones keep counting.
  if (previous === undefined && current.counts.size >= MAX_BUCKETS) return;
  current.counts.set(key, (previous ?? 0) + count);
}

/** Count one checked page. Passed pages are counted without their section. */
export function recordPageLimit(event: PageLimitEvent, time = Date.now()): void {
  add({
    day: moscowDay(time),
    outcome: event.limited ? "limited" : "passed",
    reason: event.limited ? (event.reason ?? "unknown") : "-",
    subject: event.subject,
    client: event.client,
    platform: event.platform,
    request: event.background ? "background" : "document",
    metadata: event.metadata,
    section: event.limited ? event.section : "*",
  }, 1);
}

function bucketOf(key: string, count: number): PageLimitBucket {
  const [day, outcome, reason, subject, client, platform, request, metadata, section] = key.split("|");
  return {
    day,
    outcome: outcome as PageLimitBucket["outcome"],
    reason,
    subject: subject as PageLimitSubject,
    client: client as PageLimitClient,
    platform: platform as PageLimitPlatform,
    request: request as PageLimitBucket["request"],
    metadata: metadata === "1",
    section,
    count,
  };
}

/** Everything counted since the last call; the store starts over. */
export function takePageLimitStats(): PageLimitBucket[] {
  const current = store();
  const taken = current.counts;
  current.counts = new Map();
  return [...taken].map(([key, count]) => bucketOf(key, count));
}

/** Put back buckets a failed write could not save (within the same size cap). */
export function restorePageLimitStats(buckets: readonly PageLimitBucket[]): void {
  for (const { count, ...bucket } of buckets) add(bucket, count);
}

import type { GglApplication, GglApplicationsView } from "@/lib/seo/gogetlinks-applications";
import type { GglMessageDto, GglOverviewResponse, GglThreadDto } from "./types";

export interface ApplicationsCacheSignature {
  expectedCount?: number | null;
  accountSyncedAt?: string | null;
}

export interface ApplicationsTabUiState {
  query: string;
  sort: string;
  visibleCount: number;
}

export type ThreadCacheKeyInput = Pick<
  GglThreadDto,
  "id" | "lastMessageAt" | "updatedAt" | "unreadCount" | "needsReply"
> & {
  order?: { status?: string | null } | null;
};

export interface CachedThreadMessagesEntry {
  messages: GglMessageDto[];
  refreshError: string | null;
}

interface StoredApplicationsViewEntry {
  view: GglApplicationsView;
  expectedCount: number | null;
  accountSyncedAt: string | null;
}

interface StoredThreadMessagesEntry extends CachedThreadMessagesEntry {
  fingerprint: string;
}

const applicationsViewCache = new Map<string, StoredApplicationsViewEntry>();
const applicationsUiStateCache = new Map<string, ApplicationsTabUiState>();
const threadMessagesCache = new Map<string, StoredThreadMessagesEntry>();
const overviewCache = new Map<boolean, GglOverviewResponse>();

function toCampaignKey(campaignId: number | undefined): string {
  return String(campaignId ?? "default");
}

function normalizeDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const cleaned = domain.trim().toLowerCase().replace(/^www\./, "");
  return cleaned.length > 0 ? cleaned : null;
}

export function getCachedApplicationsView(
  campaignId: number | undefined,
  signature?: ApplicationsCacheSignature,
): GglApplicationsView | null {
  const key = toCampaignKey(campaignId);
  const entry = applicationsViewCache.get(key);
  if (!entry) return null;

  const cachedCount = Math.max(
    entry.view.snapshot.sourceTotal ?? 0,
    entry.view.snapshot.applications.length,
  );

  if (
    typeof signature?.expectedCount === "number" &&
    Number.isFinite(signature.expectedCount) &&
    signature.expectedCount > 0 &&
    signature.expectedCount !== cachedCount
  ) {
    return null;
  }

  if (
    signature?.accountSyncedAt !== undefined &&
    signature.accountSyncedAt !== null &&
    entry.accountSyncedAt !== null &&
    signature.accountSyncedAt !== entry.accountSyncedAt
  ) {
    return null;
  }

  return entry.view;
}

export function setCachedApplicationsView(
  campaignId: number | undefined,
  view: GglApplicationsView,
  signature?: ApplicationsCacheSignature,
): void {
  const key = toCampaignKey(campaignId);
  const cachedCount = Math.max(
    view.snapshot.sourceTotal ?? 0,
    view.snapshot.applications.length,
  );
  applicationsViewCache.set(key, {
    view,
    expectedCount:
      typeof signature?.expectedCount === "number" && Number.isFinite(signature.expectedCount)
        ? signature.expectedCount
        : cachedCount,
    accountSyncedAt: signature?.accountSyncedAt ?? null,
  });
}

export function getCachedApplicationsUiState(
  campaignId: number | undefined,
): ApplicationsTabUiState | null {
  const key = toCampaignKey(campaignId);
  const state = applicationsUiStateCache.get(key);
  return state ? { ...state } : null;
}

export function setCachedApplicationsUiState(
  campaignId: number | undefined,
  state: ApplicationsTabUiState,
): void {
  const key = toCampaignKey(campaignId);
  applicationsUiStateCache.set(key, { ...state });
}

export function invalidateApplicationsCache(campaignId?: number): void {
  if (campaignId === undefined) {
    applicationsViewCache.clear();
    return;
  }
  applicationsViewCache.delete(toCampaignKey(campaignId));
  for (const [key, entry] of applicationsViewCache.entries()) {
    if (entry.view.campaignId === campaignId) {
      applicationsViewCache.delete(key);
    }
  }
}

export function findCachedApplicationsForDonor(opts: {
  campaignId?: number;
  donorDomain?: string | null;
  donorSiteId?: number | null;
}): GglApplication[] {
  const targetSiteId =
    typeof opts.donorSiteId === "number" &&
    Number.isFinite(opts.donorSiteId) &&
    opts.donorSiteId > 0
      ? opts.donorSiteId
      : null;
  const targetDomain = normalizeDomain(opts.donorDomain);

  if (targetSiteId === null && targetDomain === null) {
    return [];
  }

  let candidateEntries: StoredApplicationsViewEntry[];
  if (opts.campaignId !== undefined) {
    const campaignKey = toCampaignKey(opts.campaignId);
    const matchingEntries = Array.from(applicationsViewCache.entries())
      .filter(([key, entry]) => key === campaignKey || entry.view.campaignId === opts.campaignId)
      .map(([, entry]) => entry);
    candidateEntries =
      matchingEntries.length > 0 ? matchingEntries : Array.from(applicationsViewCache.values());
  } else {
    candidateEntries = Array.from(applicationsViewCache.values());
  }

  const seenIds = new Set<string>();
  const matches: GglApplication[] = [];

  for (const entry of candidateEntries) {
    for (const app of entry.view.snapshot.applications) {
      const siteMatch = targetSiteId !== null && app.siteId === targetSiteId;
      const domainMatch =
        targetDomain !== null && normalizeDomain(app.domain) === targetDomain;
      if ((siteMatch || domainMatch) && !seenIds.has(app.id)) {
        seenIds.add(app.id);
        matches.push(app);
      }
    }
  }

  return matches;
}

export function buildThreadCacheFingerprint(thread: ThreadCacheKeyInput): string {
  return [
    thread.id,
    thread.lastMessageAt ?? "",
    thread.updatedAt ?? "",
    String(thread.unreadCount ?? 0),
    thread.needsReply ? "1" : "0",
    thread.order?.status ?? "",
  ].join("|");
}

export function getCachedThreadMessages(
  thread: Parameters<typeof buildThreadCacheFingerprint>[0],
): CachedThreadMessagesEntry | null {
  const entry = threadMessagesCache.get(thread.id);
  if (!entry) return null;

  const currentFingerprint = buildThreadCacheFingerprint(thread);
  if (entry.fingerprint !== currentFingerprint) {
    return null;
  }

  return {
    messages: entry.messages,
    refreshError: entry.refreshError,
  };
}

/**
 * Returns the last loaded messages for a thread even if its fingerprint changed,
 * so the chat feed can render existing messages immediately on tab switch without
 * collapsing or jumping while a background refresh runs.
 */
export function getLastKnownThreadMessages(
  threadId: string | null | undefined,
): CachedThreadMessagesEntry | null {
  if (!threadId) return null;
  const entry = threadMessagesCache.get(threadId);
  if (!entry) return null;
  return {
    messages: entry.messages,
    refreshError: entry.refreshError,
  };
}

export function setCachedThreadMessages(
  thread: Parameters<typeof buildThreadCacheFingerprint>[0],
  data: { messages: GglMessageDto[]; refreshError?: string | null },
): void {
  threadMessagesCache.set(thread.id, {
    fingerprint: buildThreadCacheFingerprint(thread),
    messages: data.messages,
    refreshError: data.refreshError ?? null,
  });
}

export function invalidateThreadMessagesCache(threadId?: string): void {
  if (threadId !== undefined) {
    threadMessagesCache.delete(threadId);
    return;
  }
  threadMessagesCache.clear();
}

export function getCachedOverview(includeOtherProjects: boolean): GglOverviewResponse | null {
  return overviewCache.get(includeOtherProjects) ?? null;
}

export function setCachedOverview(
  includeOtherProjects: boolean,
  overview: GglOverviewResponse,
): void {
  overviewCache.set(includeOtherProjects, overview);
}

export function invalidateOverviewCache(): void {
  overviewCache.clear();
}

export function resetSeoLinksTabCache(): void {
  applicationsViewCache.clear();
  applicationsUiStateCache.clear();
  threadMessagesCache.clear();
  overviewCache.clear();
}

export const AD_CAMPAIGN_ID = "akciya_setup10";
export const AD_VISIT_ENTITY = "AdCampaignVisit";
export const AD_CAMPAIGN_ERID = "sKjnGhcf5iyz4yJ3P5kFicuGJe9X3kdfF8JHMV7Yq6Tsw8o";
export const AD_CAMPAIGN_COOKIE = "wesetup.ad-campaign";
export const AD_CAMPAIGN_MAX_AGE = 180 * 24 * 60 * 60;
export type AdAttribution = { id: string; visitorId: string };

export function readAdAttribution(raw: unknown): AdAttribution | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  return value.id === AD_CAMPAIGN_ID && typeof value.visitorId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.visitorId)
    ? { id: AD_CAMPAIGN_ID, visitorId: value.visitorId } : null;
}

/** Count document navigations, not link previews, RSC fetches or prefetches. */
export function isAdCampaignNavigation(request: { method: string; url: string; headers: { get(name: string): string | null } }): boolean {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/akciya" || url.searchParams.get("erid") !== AD_CAMPAIGN_ERID) return false;
  if (request.headers.get("rsc") === "1" || request.headers.get("next-router-prefetch") || /prefetch/i.test(`${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`)) return false;
  const destination = request.headers.get("sec-fetch-dest");
  if (destination && destination !== "document") return false;
  const ua = request.headers.get("user-agent") ?? "";
  return !!ua && !/bot|crawler|spider|preview|facebookexternalhit|whatsapp|curl|wget|headless/i.test(ua);
}

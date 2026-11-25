import type { NextRequest, NextResponse } from "next/server";
import { AD_CAMPAIGN_COOKIE, AD_CAMPAIGN_ID, AD_CAMPAIGN_MAX_AGE, AD_VISIT_ENTITY, isAdCampaignNavigation } from "./ad-campaign";
import { issueAdTouch, readAdTouch } from "./ad-campaign-cookie.server";

// Lazy storage keeps database initialization out of unrelated proxy requests.
export const adCampaignStorage = { async db() { return (await import("@/lib/db")).db; } };

/** Analytics must never break landing navigation. Store no IPs or user agents. */
export async function recordAdCampaignVisit(req: NextRequest, res: NextResponse): Promise<void> {
  if (!isAdCampaignNavigation(req)) return;
  try {
    const now = Date.now();
    let token = req.cookies.get(AD_CAMPAIGN_COOKIE)?.value;
    let touch = readAdTouch(token, now);
    if (!touch) {
      token = issueAdTouch(now) ?? undefined;
      touch = readAdTouch(token, now);
    }
    if (!touch || !token) return;
    const db = await adCampaignStorage.db();
    await db.auditLog.create({ data: {
      organizationId: process.env.PLATFORM_ORG_ID || "platform",
      action: "view", entity: AD_VISIT_ENTITY, entityId: AD_CAMPAIGN_ID,
      details: { visitorId: touch.visitorId },
    } });
    res.cookies.set(AD_CAMPAIGN_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/",
      expires: new Date(touch.at + AD_CAMPAIGN_MAX_AGE * 1000),
    });
    res.headers.set("Cache-Control", "no-store");
  } catch (error) {
    console.error("[ad-campaign] visit recording failed", error instanceof Error ? error.name : "unknown");
  }
}

/** Call only after requireRoot: this is an intentionally cross-tenant report. */
export async function loadAdCampaignReport() {
  const db = await adCampaignStorage.db();
  const platformId = process.env.PLATFORM_ORG_ID || "platform";
  const campaignWhere = { isDemo: false, kind: { not: "directory" }, id: { not: platformId },
    signupSourceJson: { path: ["adCampaign", "id"], equals: AD_CAMPAIGN_ID } };
  const [visits, registrations, organizations, converted] = await Promise.all([
    db.$queryRaw<Array<{ views: bigint; visitors: bigint; since: Date | null }>>`
      SELECT COUNT(*) AS views, COUNT(DISTINCT details->>'visitorId') AS visitors, MIN("createdAt") AS since
      FROM "AuditLog" WHERE "organizationId" = ${process.env.PLATFORM_ORG_ID || "platform"}
        AND entity = ${AD_VISIT_ENTITY} AND "entityId" = ${AD_CAMPAIGN_ID} AND action = 'view'
    `,
    db.organization.count({ where: campaignWhere }),
    db.organization.findMany({ where: campaignWhere, orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, name: true, createdAt: true } }),
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT "signupSourceJson"->'adCampaign'->>'visitorId') AS count
      FROM "Organization" WHERE "signupSourceJson"->'adCampaign'->>'id' = ${AD_CAMPAIGN_ID}
        AND "isDemo" = false AND kind <> 'directory' AND id <> ${platformId}
    `,
  ]);
  const views = Number(visits[0]?.views ?? 0);
  const visitors = Number(visits[0]?.visitors ?? 0);
  const convertedVisitors = Number(converted[0]?.count ?? 0);
  return { views, visitors, registrations, since: visits[0]?.since ?? null, organizations,
    conversion: visitors ? Math.round(convertedVisitors / visitors * 1000) / 10 : null };
}

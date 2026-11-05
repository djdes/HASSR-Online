import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { decimalToNumber, serializeGglAccount } from "@/lib/seo/gogetlinks-sync.server";
import { ensureDefaultSimilarwebSnapshots } from "@/lib/seo/similarweb-seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  return new Date(date).toISOString();
}

export async function GET(request: Request) {
  await requireRoot();

  const url = new URL(request.url);
  const includeOtherProjects = url.searchParams.get("includeOtherProjects") === "true";

  await ensureDefaultSimilarwebSnapshots(db);

  const [
    accountRow,
    campaignsRaw,
    otherProjectsCampaignsCount,
    ordersRaw,
    threadsRaw,
    plansRaw,
    slotsRaw,
    articlesRaw,
    similarwebRaw,
  ] = await Promise.all([
    db.gglAccount.findFirst({ orderBy: { createdAt: "asc" } }),
    db.gglCampaign.findMany({
      where: includeOtherProjects ? undefined : { isWesetup: true },
      orderBy: [{ isWesetup: "desc" }, { state: "asc" }, { gglCampaignId: "desc" }],
    }),
    db.gglCampaign.count({
      where: { isWesetup: false },
    }),
    db.gglOrder.findMany({
      where: includeOtherProjects ? undefined : { campaign: { isWesetup: true } },
      include: {
        campaign: {
          select: {
            id: true,
            gglCampaignId: true,
            name: true,
            domain: true,
            isWesetup: true,
            state: true,
          },
        },
      },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    }),
    db.gglThread.findMany({
      where: includeOtherProjects ? undefined : { campaign: { isWesetup: true } },
      include: {
        campaign: {
          select: {
            id: true,
            gglCampaignId: true,
            name: true,
            domain: true,
            isWesetup: true,
          },
        },
        order: {
          select: {
            id: true,
            gglReviewId: true,
            donorDomain: true,
            targetUrl: true,
            anchor: true,
            priceRub: true,
            status: true,
            publishedUrl: true,
          },
        },
      },
      orderBy: [{ needsReply: "desc" }, { unreadCount: "desc" }, { lastMessageAt: "desc" }],
    }),
    db.gglSchedulePlan.findMany({
      where: includeOtherProjects ? undefined : { campaign: { isWesetup: true } },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    }),
    db.gglPlannedSlot.findMany({
      where: includeOtherProjects ? undefined : { plan: { campaign: { isWesetup: true } } },
      include: {
        plan: {
          select: {
            id: true,
            name: true,
            kind: true,
            campaignId: true,
          },
        },
        article: {
          select: {
            id: true,
            gglArticleId: true,
            title: true,
            announcement: true,
            bodyHtml: true,
            anchor: true,
            anchorKind: true,
            status: true,
          },
        },
      },
      orderBy: [{ scheduledDate: "asc" }, { createdAt: "asc" }],
    }),
    db.gglArticle.findMany({
      where: includeOtherProjects ? undefined : { campaign: { isWesetup: true } },
      orderBy: { updatedAt: "desc" },
    }),
    db.seoCompetitorSnapshot.findMany({
      orderBy: [{ createdAt: "desc" }, { domain: "asc" }],
    }),
  ]);

  const account = accountRow ? serializeGglAccount(accountRow) : null;

  const campaigns = campaignsRaw.map((c) => ({
    id: c.id,
    gglCampaignId: c.gglCampaignId,
    name: c.name,
    domain: c.domain,
    siteUrl: c.siteUrl,
    isWesetup: c.isWesetup,
    state: c.state,
    spentRub: decimalToNumber(c.spentRub),
    linksCount: c.linksCount,
    requestsCount: c.requestsCount,
    qualityControl: c.qualityControl,
    statusNote: c.statusNote,
    targetAnchorsJson: c.targetAnchorsJson,
    syncedAt: toIso(c.syncedAt),
    createdAt: toIso(c.createdAt),
    updatedAt: toIso(c.updatedAt),
  }));

  const orders = ordersRaw.map((o) => ({
    id: o.id,
    gglReviewId: o.gglReviewId,
    campaignId: o.campaignId,
    campaign: o.campaign
      ? {
          id: o.campaign.id,
          gglCampaignId: o.campaign.gglCampaignId,
          name: o.campaign.name,
          domain: o.campaign.domain,
          isWesetup: o.campaign.isWesetup,
          state: o.campaign.state,
        }
      : null,
    donorSiteId: o.donorSiteId,
    donorDomain: o.donorDomain,
    donorDailyTraffic: o.donorDailyTraffic,
    donorTfCf: o.donorTfCf,
    donorTrust: o.donorTrust,
    placementFormat: o.placementFormat,
    priceRub: decimalToNumber(o.priceRub),
    targetUrl: o.targetUrl,
    anchor: o.anchor,
    publishedUrl: o.publishedUrl,
    articleId: o.articleId,
    paidAt: toIso(o.paidAt),
    cancelledAt: toIso(o.cancelledAt),
    indexedStatus: o.indexedStatus,
    status: o.status,
    origin: o.origin,
    initiatedByUserId: o.initiatedByUserId,
    initiatedByName: o.initiatedByName,
    approvedByUserId: o.approvedByUserId,
    approvedByName: o.approvedByName,
    approvedAt: toIso(o.approvedAt),
    plannedSlotId: o.plannedSlotId,
    createdAt: toIso(o.createdAt),
    updatedAt: toIso(o.updatedAt),
  }));

  const threads = threadsRaw.map((t) => ({
    id: t.id,
    gglThreadKey: t.gglThreadKey,
    orderId: t.orderId,
    campaignId: t.campaignId,
    campaign: t.campaign ?? null,
    order: t.order
      ? {
          ...t.order,
          priceRub: decimalToNumber(t.order.priceRub),
        }
      : null,
    donorDomain: t.donorDomain,
    webmasterLogin: t.webmasterLogin,
    subject: t.subject,
    unreadCount: t.unreadCount,
    needsReply: t.needsReply,
    lastMessageAt: toIso(t.lastMessageAt),
    lastMessagePreview: t.lastMessagePreview,
    createdAt: toIso(t.createdAt),
    updatedAt: toIso(t.updatedAt),
  }));

  const plans = plansRaw.map((p) => ({
    id: p.id,
    name: p.name,
    campaignId: p.campaignId,
    kind: p.kind,
    budgetRub: p.budgetRub,
    maxPricePerLinkRub: p.maxPricePerLinkRub,
    startsAt: toIso(p.startsAt),
    scheduleDaysOfWeek: p.scheduleDaysOfWeek,
    minTfCf: p.minTfCf,
    minTrust: p.minTrust,
    minDailyTraffic: p.minDailyTraffic,
    allowedFormats: p.allowedFormats,
    anchorMixBrandPct: p.anchorMixBrandPct,
    isActive: p.isActive,
    createdByUserId: p.createdByUserId,
    createdAt: toIso(p.createdAt),
    updatedAt: toIso(p.updatedAt),
  }));

  const slots = slotsRaw.map((s) => ({
    id: s.id,
    planId: s.planId,
    plan: s.plan ?? null,
    scheduledDate: s.scheduledDate,
    maxPriceRub: s.maxPriceRub,
    estimatedPriceRub: s.estimatedPriceRub,
    targetUrl: s.targetUrl,
    targetKeyword: s.targetKeyword,
    sourceSnapshotId: s.sourceSnapshotId,
    topvisorPosSnapshot: s.topvisorPosSnapshot,
    selectionReason: s.selectionReason,
    donorSiteId: s.donorSiteId,
    donorDomain: s.donorDomain,
    donorMetricsJson: s.donorMetricsJson,
    placementFormat: s.placementFormat,
    anchor: s.anchor,
    anchorKind: s.anchorKind,
    articleId: s.articleId,
    article: s.article ?? null,
    briefText: s.briefText,
    alternativeDonorsJson: s.alternativeDonorsJson,
    status: s.status,
    approvedByUserId: s.approvedByUserId,
    approvedByName: s.approvedByName,
    approvedAt: toIso(s.approvedAt),
    createdAt: toIso(s.createdAt),
    updatedAt: toIso(s.updatedAt),
  }));

  const articles = articlesRaw.map((a) => ({
    id: a.id,
    gglArticleId: a.gglArticleId,
    campaignId: a.campaignId,
    targetUrl: a.targetUrl,
    targetKeyword: a.targetKeyword,
    anchor: a.anchor,
    anchorKind: a.anchorKind,
    title: a.title,
    announcement: a.announcement,
    bodyHtml: a.bodyHtml,
    metaTitle: a.metaTitle,
    metaDescription: a.metaDescription,
    metaKeywords: a.metaKeywords,
    status: a.status,
    createdByUserId: a.createdByUserId,
    createdAt: toIso(a.createdAt),
    updatedAt: toIso(a.updatedAt),
  }));

  const similarwebSnapshots = similarwebRaw.map((snap) => ({
    id: snap.id,
    domain: snap.domain,
    periodLabel: snap.periodLabel,
    visitsMonthly: snap.visitsMonthly,
    organicSharePct: snap.organicSharePct,
    paidSharePct: snap.paidSharePct,
    bouncePct: snap.bouncePct,
    pagesPerVisit: snap.pagesPerVisit,
    clusters: snap.clusters,
    sourceKind: snap.sourceKind,
    createdByUserId: snap.createdByUserId,
    createdAt: toIso(snap.createdAt),
  }));

  const now = new Date();
  const monthStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sevenDaysAheadKey = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);

  const wesetupOrders = orders.filter((o) => o.campaign?.isWesetup !== false);
  const wesetupThreads = threads.filter((t) => t.campaign?.isWesetup !== false);

  const monthSpentRub = wesetupOrders.reduce((sum, o) => {
    if (o.status === "rejected" || o.status === "failed") return sum;
    const refDate = o.paidAt ? new Date(o.paidAt) : o.createdAt ? new Date(o.createdAt) : null;
    if (refDate && refDate >= monthStartUtc) {
      return sum + o.priceRub;
    }
    return sum;
  }, 0);

  const monthlyPlanBudgetRub = plans
    .filter((p) => p.isActive)
    .reduce((sum, p) => sum + p.budgetRub, 0);

  const next7DaysPendingRub = slots
    .filter((s) => s.status === "pending_approval" && s.scheduledDate <= sevenDaysAheadKey)
    .reduce((sum, s) => sum + (s.estimatedPriceRub ?? s.maxPriceRub), 0);

  return NextResponse.json({
    includeOtherProjects,
    account,
    campaigns,
    orders,
    threads,
    plans,
    slots,
    articles,
    similarwebSnapshots,
    metrics: {
      monthSpentRub: Math.round(monthSpentRub * 100) / 100,
      monthlyPlanBudgetRub,
      next7DaysPendingRub,
      counts: {
        paidOrders: wesetupOrders.filter((o) => o.status === "paid").length,
        inProgressOrders: wesetupOrders.filter(
          (o) => o.status === "in_progress" || o.status === "pending_webmaster" || o.status === "sending",
        ).length,
        onCheckOrders: wesetupOrders.filter((o) => o.status === "on_check").length,
        needsReplacementOrders: wesetupOrders.filter((o) => o.status === "needs_replacement").length,
        unreadThreads: wesetupThreads.filter((t) => t.unreadCount > 0 || t.needsReply).length,
        pendingApprovalSlots: slots.filter((s) => s.status === "pending_approval").length,
        otherProjectsCampaignsCount,
      },
    },
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  GglAuthError,
  GglCallError,
  GglIsolationError,
} from "@/lib/seo/gogetlinks-client.server";
import {
  createManualGglOrder,
  GglOrderError,
  resolveGglActorFromSession,
} from "@/lib/seo/gogetlinks-orders.server";
import { decimalToNumber } from "@/lib/seo/gogetlinks-sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function toIso(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  return new Date(date).toISOString();
}

const manualArticleDraftSchema = z.object({
  title: z.string().trim().min(3).max(300),
  announcement: z.string().trim().max(1500).optional(),
  bodyHtml: z.string().trim().min(10).max(60_000),
  metaTitle: z.string().trim().max(300).optional(),
  metaDescription: z.string().trim().max(500).optional(),
  metaKeywords: z.string().trim().max(500).optional(),
});

const manualOrderBodySchema = z.object({
  campaignId: z.string().trim().min(1).max(100).optional(),
  donorSiteId: z.number().int().positive("Укажите ID площадки-донора"),
  donorDomain: z.string().trim().min(2, "Укажите домен площадки-донора").max(200),
  placementFormat: z.enum(["article", "note", "context"]),
  maxPriceRub: z
    .number()
    .positive("Укажите максимальную цену ссылки")
    .max(1_000_000),
  targetUrl: z.string().trim().min(1, "Укажите целевой URL wesetup.ru").max(400),
  anchor: z.string().trim().min(1, "Укажите текст анкора").max(200),
  anchorKind: z.enum(["exact", "diluted", "url_brand"]).optional(),
  articleId: z.string().trim().min(1).max(100).nullable().optional(),
  articleDraft: manualArticleDraftSchema.nullable().optional(),
  briefText: z.string().trim().max(3000).nullable().optional(),
  idempotencyKey: z
    .string()
    .trim()
    .min(1, "Укажите ключ идемпотентности (idempotencyKey)")
    .max(160),
});

export async function GET(request: Request) {
  await requireRoot();

  const url = new URL(request.url);
  const includeOtherProjects = url.searchParams.get("includeOtherProjects") === "true";
  const statusFilter = url.searchParams.get("status")?.trim() || undefined;
  const originFilter = url.searchParams.get("origin")?.trim() || undefined;
  const initiatedByUserId = url.searchParams.get("initiatedByUserId")?.trim() || undefined;

  const ordersRaw = await db.gglOrder.findMany({
    where: {
      ...(includeOtherProjects ? {} : { campaign: { isWesetup: true } }),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(originFilter ? { origin: originFilter } : {}),
      ...(initiatedByUserId ? { initiatedByUserId } : {}),
    },
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
  });

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

  return NextResponse.json({ orders });
}

export async function POST(request: Request) {
  const session = await requireRoot();

  const rawBody = await request.json().catch(() => null);
  const parsed = manualOrderBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные параметры ручной закупки" },
      { status: 400 },
    );
  }

  try {
    const actor = await resolveGglActorFromSession(session);
    const result = await createManualGglOrder(parsed.data, actor);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof GglOrderError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof GglIsolationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof GglAuthError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof GglCallError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[ggl-orders] unexpected error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Не удалось создать ручную заявку в GoGetLinks",
      },
      { status: 500 },
    );
  }
}

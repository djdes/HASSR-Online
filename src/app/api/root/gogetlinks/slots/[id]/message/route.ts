import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { checkGglComposerAvailability, sendGglFirstMessage } from "@/lib/seo/gogetlinks-client.server";
import { isWesetupDomain } from "@/lib/seo/gogetlinks-codec";
import { getAndRefreshGglThread, registerGglPersonalThread } from "@/lib/seo/gogetlinks-chat.server";

export const runtime = "nodejs";
export const maxDuration = 60;

const messageSchema = z.object({
  siteId: z.number().int().positive(),
  body: z.string().trim().min(1).max(8000),
});

async function persistDonorPmAvailability(
  slotId: string,
  donorSiteId: number,
  pmOpen: boolean,
): Promise<void> {
  try {
    const slot = await db.gglPlannedSlot.findUnique({
      where: { id: slotId },
      select: { donorSiteId: true, donorMetricsJson: true },
    });
    if (!slot || slot.donorSiteId !== donorSiteId) return;
    const baseMetrics =
      slot.donorMetricsJson && typeof slot.donorMetricsJson === "object"
        ? (slot.donorMetricsJson as Record<string, unknown>)
        : {};
    if (baseMetrics.pmOpen === pmOpen) return;
    await db.gglPlannedSlot.update({
      where: { id: slotId },
      data: {
        donorMetricsJson: {
          ...baseMetrics,
          pmOpen,
        },
      },
    });
  } catch {
    // Non-critical telemetry update
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireRoot();
  const { id } = await context.params;
  const query = new URL(request.url).searchParams;
  const siteId = Number.parseInt(query.get("siteId") ?? "", 10);
  if (!id || !Number.isSafeInteger(siteId) || siteId <= 0) {
    return NextResponse.json({ status: "invalid" }, { status: 400 });
  }
  const slot = await db.gglPlannedSlot.findUnique({
    where: { id },
    select: {
      donorSiteId: true,
      donorDomain: true,
      donorMetricsJson: true,
      status: true,
      plan: {
        select: {
          campaign: {
            select: { id: true, gglCampaignId: true, domain: true, isWesetup: true },
          },
        },
      },
    },
  });
  const campaign = slot?.plan.campaign;
  if (
    slot?.status !== "pending_approval" ||
    slot.donorSiteId !== siteId ||
    !slot.donorDomain ||
    !campaign?.isWesetup ||
    !isWesetupDomain(campaign.domain)
  ) {
    return NextResponse.json({ status: "changed" }, { status: 409 });
  }

  const gglCampaignId = campaign.gglCampaignId;
  const directPersonalUrl = `https://gogetlinks.net/privateMessage/personal/comp_id/${gglCampaignId}/site_id/${siteId}`;
  const directCatalogUrl = `https://gogetlinks.net/searchSites?in_site_name=${encodeURIComponent(slot.donorDomain)}`;

  const metricsRec =
    slot.donorMetricsJson && typeof slot.donorMetricsJson === "object"
      ? (slot.donorMetricsJson as Record<string, unknown>)
      : {};
  const forceRefresh = query.get("refresh") === "1";
  if (!forceRefresh && typeof metricsRec.pmOpen === "boolean") {
    return NextResponse.json({
      status: "ok",
      pmOpen: metricsRec.pmOpen,
      gglCampaignId,
      directPersonalUrl,
      directCatalogUrl,
    });
  }

  const availability = await checkGglComposerAvailability({
    campaignId: gglCampaignId,
    siteId,
  });
  const pmOpen =
    availability === "open" ? true : availability === "closed" ? false : null;
  if (pmOpen !== null) {
    await persistDonorPmAvailability(id, siteId, pmOpen);
  }
  return NextResponse.json({
    status: "ok",
    pmOpen,
    gglCampaignId,
    directPersonalUrl,
    directCatalogUrl,
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const parsed = messageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ status: "invalid" }, { status: 400 });
  const { id } = await context.params;
  const { siteId, body } = parsed.data;
  const slot = await db.gglPlannedSlot.findUnique({
    where: { id },
    select: {
      donorSiteId: true,
      donorDomain: true,
      status: true,
      plan: { select: { campaign: { select: { id: true, gglCampaignId: true, domain: true, isWesetup: true } } } },
    },
  });
  const campaign = slot?.plan.campaign;
  if (slot?.status !== "pending_approval" || slot.donorSiteId !== siteId || !slot.donorDomain || !campaign?.isWesetup ||
      !isWesetupDomain(campaign.domain)) {
    return NextResponse.json({ status: "changed" }, { status: 409 });
  }
  const { gglCampaignId: campaignId } = campaign;
  const directPersonalUrl = `https://gogetlinks.net/privateMessage/personal/comp_id/${campaignId}/site_id/${siteId}`;
  const directCatalogUrl = `https://gogetlinks.net/searchSites?in_site_name=${encodeURIComponent(slot.donorDomain)}`;
  const digest = createHash("sha256").update(JSON.stringify([campaignId, siteId, body.replace(/\s+/g, " ")])).digest("hex");
  try {
    const status = await sendGglFirstMessage({
      campaignId,
      siteId,
      body,
      claim: async () => {
        const { count } = await db.platformSetting.createMany({
          data: [{ key: `ggl:first-message:${digest}`, value: "submitted" }],
          skipDuplicates: true,
        });
        return count === 1;
      },
    });
    if (status === "unavailable") {
      await persistDonorPmAvailability(id, siteId, false);
    } else if (status === "sent" || status === "unconfirmed" || status === "duplicate") {
      await persistDonorPmAvailability(id, siteId, true);
      try {
        const thread = await registerGglPersonalThread({
          campaignId: campaign.id, gglCampaignId: campaignId, siteId, domain: slot.donorDomain,
        });
        await getAndRefreshGglThread(thread.id);
      } catch (error) {
        console.warn("[ggl-first-message] personal conversation import failed", error instanceof Error ? error.name : "UnknownError");
      }
    }
    return NextResponse.json({
      status,
      pmOpen: status === "unavailable" ? false : true,
      gglCampaignId: campaignId,
      directPersonalUrl,
      directCatalogUrl,
    });
  } catch (error) {
    console.warn("[ggl-first-message] composer request failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ status: "error", gglCampaignId: campaignId, directPersonalUrl, directCatalogUrl }, { status: 502 });
  }
}

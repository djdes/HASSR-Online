import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { sendGglFirstMessage } from "@/lib/seo/gogetlinks-client.server";
import { isWesetupDomain } from "@/lib/seo/gogetlinks-codec";
import { getAndRefreshGglThread, registerGglPersonalThread } from "@/lib/seo/gogetlinks-chat.server";

export const runtime = "nodejs";
export const maxDuration = 60;

const messageSchema = z.object({
  siteId: z.number().int().positive(),
  body: z.string().trim().min(1).max(8000),
});

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
    if (status === "sent" || status === "unconfirmed" || status === "duplicate") {
      try {
        const thread = await registerGglPersonalThread({
          campaignId: campaign.id, gglCampaignId: campaignId, siteId, domain: slot.donorDomain,
        });
        await getAndRefreshGglThread(thread.id);
      } catch (error) {
        console.warn("[ggl-first-message] personal conversation import failed", error instanceof Error ? error.name : "UnknownError");
      }
    }
    return NextResponse.json({ status });
  } catch (error) {
    console.warn("[ggl-first-message] composer request failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ status: "error" }, { status: 502 });
  }
}
